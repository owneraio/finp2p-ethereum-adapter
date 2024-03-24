// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/utils/TokenTimelock.sol)

pragma solidity ^0.8.0;

/**
 * @dev Interface of the FinP2P protocol operations.
 */
interface IFinP2PCommon {
    function getBalance(string memory assetId, string memory finId) external view returns (uint256);
}
