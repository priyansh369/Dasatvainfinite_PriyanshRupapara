// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for header verifier (light-client or zk-based in production).
interface IHeaderVerifier {
    struct BlockHeader {
        uint256 sourceBlock;
        bytes32 root;
    }

    /// @return valid True when the supplied header is authentic.
    function verifyHeader(BlockHeader calldata header) external view returns (bool valid);
}
