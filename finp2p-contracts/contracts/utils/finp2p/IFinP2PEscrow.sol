// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./IFinP2PCommon.sol";

/**
 * @dev Interface of the FinP2P protocol escrow operations.
 */
interface IFinP2PEscrow is IFinP2PCommon {

    struct LockInfo {
        string assetId;
        uint256 amount;
    }

    event Hold(string assetId, string finId, uint256 quantity, bytes16 operationId);
    event Release(string assetId, string sourceFinId, string destinationFinId, uint256 quantity, bytes16 operationId);
    event Rollback(string assetId, string finId, uint256 quantity, bytes16 operationId);

    function hold(bytes16 operationId, string memory nonce, string memory assetId, string memory sellerFinId,
        string memory buyerFinId, string memory quantity, string memory settlementAsset, uint256 settlementAmount, bytes memory signature) external;

    function getLockInfo(bytes16 operationId) external view returns (LockInfo memory);

    function release(bytes16 operationId, string memory destinationFinId) external;

    function rollback(bytes16 operationId) external;

}