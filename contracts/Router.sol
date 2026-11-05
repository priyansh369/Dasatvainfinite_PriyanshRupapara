// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/MerkleTree.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Router — Sepolia (N1)
/// @notice Locks native ETH, appends a leaf to an on-chain incremental Merkle tree,
///         and allows the original sender to reclaim funds after deadline + reclaimGrace.
/// @dev KNOWN LIMITATION: Merkle tree depth is fixed at 8 (max 256 leaves per deployment).
///      A production system should handle tree exhaustion gracefully (e.g., rolling trees).
contract Router is ReentrancyGuard {
    using MerkleTree for MerkleTree.Bytes32PushTree;

    // ── Types ────────────────────────────────────────────────────────────────

    struct RequestInfo {
        address sender;
        uint256 amount;
        uint256 deadline;
        bool    reclaimed;
    }

    // ── Immutables ───────────────────────────────────────────────────────────

    uint256 public immutable requestTtl;
    uint256 public immutable reclaimGrace;

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice Incremental Merkle tree storing all request leaves.
    MerkleTree.Bytes32PushTree private _tree;

    /// @notice The latest Merkle root (updated on every push).
    /// @dev OZ MerkleTree does NOT store the root internally; we cache it here.
    bytes32 private _latestRoot;

    /// @notice Monotonically increasing request counter (also used as leaf index).
    uint256 public nextId;

    /// @notice id → RequestInfo metadata.
    mapping(uint256 => RequestInfo) public requests;

    // ── Events ───────────────────────────────────────────────────────────────

    event RequestCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        uint256         amount,
        uint256         deadline,
        bytes32         leaf,
        bytes32         newRoot,
        uint256         index
    );

    event Reclaimed(uint256 indexed id, address indexed sender, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────────

    /// @param _requestTtl   Time (seconds) from now until a request expires.
    /// @param _reclaimGrace Extra wait (seconds) after deadline before sender can reclaim.
    constructor(uint256 _requestTtl, uint256 _reclaimGrace) {
        requestTtl   = _requestTtl;
        reclaimGrace = _reclaimGrace;

        // KNOWN LIMITATION: depth 8 → max 256 leaves per deployment.
        // Uses OZ default commutativeKeccak256 hasher, compatible with MerkleProof.verify().
        _latestRoot = _tree.setup(8, bytes32(0));
    }

    // ── External functions ───────────────────────────────────────────────────

    /// @notice Lock ETH and register a cross-chain request.
    /// @param recipient Address on the destination chain to receive wDETH tokens.
    function initiateRequest(address recipient) external payable returns (uint256 id) {
        require(msg.value > 0, "Router: must send ETH");

        id = nextId++;
        // KNOWN LIMITATION: block.timestamp can be manipulated by validators by ~12 s.
        uint256 deadline = block.timestamp + requestTtl;

        // Leaf encodes chainid + router address to scope the leaf to this specific deployment.
        bytes32 leaf = keccak256(
            abi.encode(block.chainid, address(this), id, msg.sender, recipient, msg.value, deadline)
        );

        // Push leaf; library returns (leafIndex, newRoot).
        (uint256 index, bytes32 newRoot) = _tree.push(leaf);

        // The index must equal id — they both increment monotonically from 0.
        assert(index == id);

        _latestRoot = newRoot;

        requests[id] = RequestInfo({
            sender:    msg.sender,
            amount:    msg.value,
            deadline:  deadline,
            reclaimed: false
        });

        emit RequestCreated(id, msg.sender, recipient, msg.value, deadline, leaf, newRoot, index);
    }

    /// @notice Returns the current Merkle root of all registered requests.
    function root() external view returns (bytes32) {
        return _latestRoot;
    }

    /// @notice Refund the sender's ETH after deadline + reclaimGrace has passed.
    /// @param id The request id to reclaim.
    function reclaim(uint256 id) external nonReentrant {
        RequestInfo storage req = requests[id];
        require(req.sender != address(0), "Router: unknown id");
        require(req.sender == msg.sender,  "Router: not sender");
        require(!req.reclaimed,            "Router: already reclaimed");
        // KNOWN LIMITATION: no on-chain guard against dual-spend across chains;
        // the deadline + reclaimGrace window is the sole protection in this demo.
        require(
            block.timestamp > req.deadline + reclaimGrace,
            "Router: too early to reclaim"
        );

        // Checks-Effects-Interactions
        req.reclaimed = true;
        uint256 amount = req.amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Router: ETH transfer failed");

        emit Reclaimed(id, msg.sender, amount);
    }

    // ── Fallback ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
