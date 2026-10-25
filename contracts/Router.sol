// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/MerkleTree.sol";

/// @title Router — Sepolia (N1)
/// @notice Locks native ETH, appends a leaf to an on-chain incremental Merkle tree,
///         and allows the original sender to reclaim funds after the deadline + 1 hour.
/// @dev KNOWN LIMITATION: Merkle tree depth is fixed at 8 (max 256 leaves per deployment).
///      A production system should handle tree exhaustion gracefully (e.g., rolling trees).
contract Router {
    using MerkleTree for MerkleTree.Bytes32PushTree;

    // ── Types ────────────────────────────────────────────────────────────────

    struct Request {
        address sender;
        address recipient;
        uint256 value;
        uint256 deadline;
        bool    reclaimed; // true once reclaim() succeeds
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice Incremental Merkle tree storing all request leaves.
    MerkleTree.Bytes32PushTree private _tree;

    /// @notice The latest Merkle root (updated on every push).
    /// @dev OZ MerkleTree does NOT store the root internally; we cache it.
    bytes32 private _latestRoot;

    /// @notice Monotonically increasing request counter (also used as leaf index).
    uint256 public nextId;

    /// @notice id → Request metadata.
    mapping(uint256 => Request) public requests;

    /// @notice id → leaf hash (stored so reclaim can verify no tampering).
    mapping(uint256 => bytes32) public leaves;

    // ── Events ───────────────────────────────────────────────────────────────

    event RequestCreated(
        uint256 indexed id,
        bytes32         leaf,
        address indexed sender,
        address indexed recipient,
        uint256         value,
        uint256         deadline
    );

    event Reclaimed(uint256 indexed id, address indexed sender, uint256 value);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        // KNOWN LIMITATION: depth 8 → max 256 leaves per deployment.
        // Uses OZ default commutativeKeccak256 hasher, compatible with MerkleProof.verify().
        _latestRoot = _tree.setup(8, bytes32(0));
    }

    // ── External functions ───────────────────────────────────────────────────

    /// @notice Lock ETH and register a cross-chain request.
    /// @param recipient Address on the destination chain to receive wDEMO tokens.
    /// @dev Deadline is 24 h from now.
    function initiateRequest(address recipient) external payable returns (uint256 id) {
        require(msg.value > 0, "Router: must send ETH");
        require(recipient != address(0), "Router: zero recipient");

        id = nextId++;
        // KNOWN LIMITATION: block.timestamp can be manipulated by validators by ~12 s.
        uint256 deadline = block.timestamp + 24 hours;

        bytes32 leaf = keccak256(abi.encode(id, msg.sender, recipient, msg.value, deadline));

        // Push leaf; library returns (leafIndex, newRoot).
        (, bytes32 newRoot) = _tree.push(leaf);
        _latestRoot = newRoot;

        requests[id] = Request({
            sender:    msg.sender,
            recipient: recipient,
            value:     msg.value,
            deadline:  deadline,
            reclaimed: false
        });
        leaves[id] = leaf;

        emit RequestCreated(id, leaf, msg.sender, recipient, msg.value, deadline);
    }

    /// @notice Refund the sender's ETH after deadline + 1 hour has passed.
    /// @param id The request id to reclaim.
    function reclaim(uint256 id) external {
        Request storage req = requests[id];
        require(req.sender != address(0), "Router: unknown id");
        require(req.sender == msg.sender, "Router: not sender");
        require(!req.reclaimed, "Router: already reclaimed");
        // Must wait deadline + 1 hour so the recipient has full time to execute on N2.
        require(block.timestamp > req.deadline + 1 hours, "Router: too early to reclaim");

        req.reclaimed = true;
        uint256 amount = req.value;

        // KNOWN LIMITATION: we cannot know if verifyAndExecute was also called on N2;
        // the deadline window is the only guard against dual-spend in this demo.
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Router: ETH transfer failed");

        emit Reclaimed(id, msg.sender, amount);
    }

    /// @notice Returns the current Merkle root of all registered requests.
    function root() external view returns (bytes32) {
        return _latestRoot;
    }

    // ── Fallback ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
