// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IHeaderVerifier.sol";

/// @title MockHeaderVerifier
/// @notice Stub verifier that accepts any block header.
/// @dev KNOWN LIMITATION: header authenticity is NOT checked.
///      Production use requires a proper light-client relay or a ZK-proof
///      (e.g., Succinct, Axiom, or a custom SP1 circuit) to trustlessly
///      verify that a Sepolia block header actually exists on chain.
contract MockHeaderVerifier is IHeaderVerifier {
    // KNOWN LIMITATION: always returns true — any root is accepted.
    function verifyHeader(BlockHeader calldata /* header */) external pure override returns (bool) {
        return true;
    }
}
