// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./IFinP2PCommon.sol";

/**
 * @dev Interface of the FinP2P protocol asset operations.
 */
interface IFinP2PAsset is IFinP2PCommon {

    event Issue(string assetId, string issuerFinId, string quantity);
    event Transfer(string assetId, string sourceFinId, string destinationFinId, string quantity);
//    event Redeem(string assetId, string sellerFinId, string quantity);

    function associateAsset(string memory assetId, address tokenAddress) external;

    function removeAsset(string memory assetId) external;

    function getAssetAddress(string memory assetId) external view returns (address);

    function issue(string memory assetId, string memory issuerFinId, string memory quantity) external;

    function transfer(string memory nonce, string memory assetId, string memory sellerFinId, string memory buyerFinId,
        string memory quantity, string memory settlementAsset, string memory settlementAmount, uint8 hashType, uint8 eip712PrimaryType, bytes memory signature) external;

//    function redeem(string memory nonce, string memory assetId, string memory sellerFinId, string memory issuerFinId, string memory quantity,
//        string memory settlementAsset, string memory settlementAmount, uint8 hashType, bytes memory signature) external;

}