// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IHeaderVerifier.sol";
import "./WrappedDemo.sol";

/// @title Verifier — Polygon Amoy (N2)
/// @notice Accepts a Merkle proof of a Sepolia request, verifies it, and mints wDEMO.
/// @dev KNOWN LIMITATION: The cross-chain root is supplied by the user and is only
///      checked against MockHeaderVerifier, which accepts anything.  A production
///      deployment needs a trustless header relay (light client / ZK proof).
contract Verifier {

    // ── Types ────────────────────────────────────────────────────────────────

    /// @notice Mirror of Router's request data (must match exactly for leaf recomputation).
    struct RequestData {
        uint256 id;
        address sender;
        address recipient;
        uint256 value;
        uint256 deadline;
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    /// @notice Header verifier (MockHeaderVerifier in this demo).
    IHeaderVerifier public immutable headerVerifier;

    /// @notice The wDEMO token this contract mints.
    WrappedDemo public immutable token;

    /// @notice Tracks consumed request ids to prevent replays.
    mapping(uint256 => bool) public executed;

    // ── Events ───────────────────────────────────────────────────────────────

    event Verified(
        uint256 indexed id,
        address indexed recipient,
        uint256         amount
    );

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _headerVerifier, address _token) {
        require(_headerVerifier != address(0), "Verifier: zero header verifier");
        require(_token != address(0), "Verifier: zero token");
        headerVerifier = IHeaderVerifier(_headerVerifier);
        token = WrappedDemo(_token);
    }

    // ── External functions ───────────────────────────────────────────────────

    /// @notice Verify a Sepolia request inclusion and mint wDEMO to the recipient.
    /// @param header  Block header carrying the Merkle root from Sepolia.
    /// @param proof   Merkle inclusion proof (sibling path) produced off-chain.
    /// @param request The request data (must match what Router stored on Sepolia).
    function verifyAndExecute(
        IHeaderVerifier.BlockHeader calldata header,
        bytes32[]                   calldata proof,
        RequestData                 calldata request
    ) external {
        // 1. Reject if deadline has already passed.
        //    This prevents executing a request that the sender could already reclaim.
        require(block.timestamp <= request.deadline, "Verifier: request expired");

        // 2. Reject replays.
        require(!executed[request.id], "Verifier: already executed");

        // 3. Verify the block header (stub; KNOWN LIMITATION — always passes).
        require(headerVerifier.verifyHeader(header), "Verifier: invalid header");

        // 4. Recompute the leaf (same encoding as Router.initiateRequest).
        bytes32 leaf = keccak256(
            abi.encode(
                request.id,
                request.sender,
                request.recipient,
                request.value,
                request.deadline
            )
        );

        // 5. Verify Merkle inclusion.
        //    MerkleProof uses commutativeKeccak256 internally, matching Router's tree.
        require(
            MerkleProof.verify(proof, header.root, leaf),
            "Verifier: invalid proof"
        );

        // 6. Mark as executed (CEI pattern — state before external calls).
        executed[request.id] = true;

        // 7. Mint wDEMO 1:1 against the locked wei.
        //    KNOWN LIMITATION: no real peg or redemption path; demo only.
        token.mint(request.recipient, request.value);

        emit Verified(request.id, request.recipient, request.value);
    }
}
