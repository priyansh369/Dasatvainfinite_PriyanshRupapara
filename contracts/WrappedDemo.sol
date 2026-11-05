// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WrappedDemo
/// @notice ERC-20 "Wrapped Demo ETH" (wDETH) minted by Verifier on Polygon Amoy.
/// @dev KNOWN LIMITATION: token is minted 1:1 against wei sent on Sepolia (for demo only).
///      No real peg, no redemption path. A production system would need a burn-and-release
///      mechanism with proper collateral accounting.
contract WrappedDemo is ERC20, Ownable {
    /// @notice Address that is permitted to call mint(). Set once via setMinter().
    address public minter;

    /// @dev Emitted when the minter is set.
    event MinterSet(address indexed minter);

    constructor(address initialOwner)
        ERC20("Wrapped Demo ETH", "wDETH")
        Ownable(initialOwner)
    {}

    /// @notice Set the minter address. Can only be called once by the owner.
    /// @param _minter Address of the Verifier contract that will call mint().
    function setMinter(address _minter) external onlyOwner {
        require(minter == address(0), "WrappedDemo: minter already set");
        require(_minter != address(0), "WrappedDemo: zero minter");
        minter = _minter;
        emit MinterSet(_minter);
    }

    /// @notice Mints `amount` tokens to `to`. Only callable by the minter (Verifier).
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "WrappedDemo: not minter");
        _mint(to, amount);
    }
}
