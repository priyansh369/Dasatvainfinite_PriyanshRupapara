// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SampleTargetReceiver
 * @notice Sample destination contract to demonstrate and test arbitrary cross-chain
 *         smart contract execution (target.call{value}(callData)).
 */
contract SampleTargetReceiver {
    event ActionExecuted(address indexed caller, uint256 value, string actionName, bytes payload);
    event ValueDeposited(address indexed from, uint256 amount);

    uint256 public totalExecutions;
    uint256 public totalValueReceived;
    string public lastAction;

    /// @notice Execute an arbitrary action triggered across chains.
    function executeAction(string calldata actionName, bytes calldata payload) external payable {
        totalExecutions++;
        totalValueReceived += msg.value;
        lastAction = actionName;

        emit ActionExecuted(msg.sender, msg.value, actionName, payload);
    }

    /// @notice Direct deposit
    receive() external payable {
        totalValueReceived += msg.value;
        emit ValueDeposited(msg.sender, msg.value);
    }
}

