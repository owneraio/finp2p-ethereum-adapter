// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

/**
 * @dev Interface of the FinP2P protocol operations.
 */
interface IFinP2PCommon {
    function getBalance(string memory assetId, string memory finId) external view returns (string memory);
}
