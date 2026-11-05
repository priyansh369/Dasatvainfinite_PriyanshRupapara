// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IHeaderVerifier.sol";
import "./WrappedDemo.sol";

/// @title Verifier — Polygon Amoy (N2)
/// @notice Accepts a Merkle proof of a Sepolia request, verifies it, and mints wDETH.
/// @dev KNOWN LIMITATION: The cross-chain root is supplied by the user and is only
///      checked against MockHeaderVerifier, which accepts anything.  A production
///      deployment needs a trustless header relay (light client / ZK proof).
contract Verifier {

    // ── Custom errors ────────────────────────────────────────────────────────

    /// @notice The request id has already been processed.
    error AlreadyProcessed(uint256 id);

    /// @notice The request deadline has passed; the recipient took too long.
    error Expired(uint256 id, uint256 deadline, uint256 currentTime);

    /// @notice The header verifier rejected the supplied header.
    error InvalidHeader();

    /// @notice The Merkle proof does not match the header root and leaf.
    error InvalidProof(uint256 id);

    // ── Types ────────────────────────────────────────────────────────────────

    /// @notice Mirror of Router's request data (must match exactly for leaf recomputation).
    struct Request {
        uint256 id;
        address sender;
        address recipient;
        uint256 amount;
        uint256 deadline;
    }

    // ── Immutables ───────────────────────────────────────────────────────────

    /// @notice Header verifier (MockHeaderVerifier in this demo).
    IHeaderVerifier public immutable headerVerifier;

    /// @notice The wDETH token this contract mints.
    WrappedDemo public immutable wrapped;

    /// @notice Chain ID of the source chain (Sepolia = 11155111).
    uint256 public immutable sourceChainId;

    /// @notice Address of the Router contract on the source chain.
    address public immutable sourceRouter;

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice Tracks consumed request ids to prevent replays.
    mapping(uint256 => bool) public processed;

    // ── Events ───────────────────────────────────────────────────────────────

    event Verified(
        uint256 indexed id,
        address indexed recipient,
        uint256         amount,
        uint256         sourceBlock
    );

    // ── Constructor ──────────────────────────────────────────────────────────

    /// @param _wrapped         Address of the WrappedDemo ERC20 token.
    /// @param _headerVerifier  Address of the IHeaderVerifier implementation.
    /// @param _sourceChainId   Chain ID of the source chain (Sepolia = 11155111).
    /// @param _sourceRouter    Address of the Router on the source chain.
    constructor(
        address _wrapped,
        address _headerVerifier,
        uint256 _sourceChainId,
        address _sourceRouter
    ) {
        require(_wrapped        != address(0), "Verifier: zero wrapped");
        require(_headerVerifier != address(0), "Verifier: zero headerVerifier");
        require(_sourceRouter   != address(0), "Verifier: zero sourceRouter");
        require(_sourceChainId  != 0,          "Verifier: zero sourceChainId");

        wrapped        = WrappedDemo(_wrapped);
        headerVerifier = IHeaderVerifier(_headerVerifier);
        sourceChainId  = _sourceChainId;
        sourceRouter   = _sourceRouter;
    }

    // ── External functions ───────────────────────────────────────────────────

    /// @notice Verify a source-chain request inclusion and mint wDETH to the recipient.
    /// @param header  Block header carrying the Merkle root from the source chain.
    /// @param proof   Merkle inclusion proof (sibling path) produced off-chain.
    /// @param req     The request data (must match what Router stored on the source chain).
    function verifyAndExecute(
        IHeaderVerifier.Header calldata header,
        bytes32[]              calldata proof,
        Request                calldata req
    ) external {
        // 1. Reject replays.
        if (processed[req.id]) revert AlreadyProcessed(req.id);

        // 2. Reject expired requests so they cannot be executed after the sender reclaimed.
        //    (The sender can only reclaim after deadline + reclaimGrace, giving the recipient
        //     time to call this function.)
        if (block.timestamp > req.deadline) revert Expired(req.id, req.deadline, block.timestamp);

        // 3. Verify the block header (stub; KNOWN LIMITATION — always passes in demo).
        if (!headerVerifier.verifyHeader(header)) revert InvalidHeader();

        // 4. Recompute the leaf using sourceChainId and sourceRouter (same as Router.initiateRequest).
        bytes32 leaf = keccak256(
            abi.encode(
                sourceChainId,
                sourceRouter,
                req.id,
                req.sender,
                req.recipient,
                req.amount,
                req.deadline
            )
        );

        // 5. Verify Merkle inclusion (commutativeKeccak256 — matches OZ MerkleTree default).
        if (!MerkleProof.verify(proof, header.root, leaf)) revert InvalidProof(req.id);

        // 6. Checks-Effects-Interactions: mark processed before external calls.
        processed[req.id] = true;

        // 7. Mint wDETH 1:1 against the locked wei on the source chain.
        //    KNOWN LIMITATION: no real peg or redemption path; demo only.
        wrapped.mint(req.recipient, req.amount);

        emit Verified(req.id, req.recipient, req.amount, header.sourceBlock);
    }
}
