// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/utils/TokenTimelock.sol)

pragma solidity ^0.8.0;

import "./IFinP2PCommon.sol";
/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IFinP2PAsset is IFinP2PCommon {

    event Issue(string assetId, string issuerFinId, uint256 quantity);
    event Transfer(string assetId, string sourceFinId, string destinationFinId, uint256 quantity);
    event Redeem(string assetId, string issuerFinId, uint256 quantity);

    function associateAsset(string memory assetId, address tokenAddress) external;

    function removeAsset(string memory assetId) external;

    function getAssetAddress(string memory assetId) external view returns (address);

    function issue(string memory assetId, string memory issuerFinId, uint256 quantity) external;

    function transfer(bytes32 nonce, string memory assetId, string memory sourceFinId, string memory destinationFinId,
        uint256 quantity, bytes32 settlementHash, bytes32 hash, bytes memory signature) external;

    function redeem(bytes32 nonce, string memory assetId, string memory account, uint256 quantity,
        bytes32 settlementHash, bytes32 hash, bytes memory signature) external;
}