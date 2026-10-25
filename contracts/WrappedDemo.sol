// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WrappedDemo
/// @notice ERC-20 token minted by Verifier on Polygon Amoy as a demo wrapped asset.
/// @dev KNOWN LIMITATION: token is minted 1:1 against wei sent on Sepolia (for demo only).
///      No real peg, no redemption path.
contract WrappedDemo is ERC20, Ownable {
    constructor(address initialOwner)
        ERC20("Wrapped Demo", "wDEMO")
        Ownable(initialOwner)
    {}

    /// @notice Mints `amount` tokens to `to`. Only callable by the owner (Verifier).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
