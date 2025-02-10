// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./IFinP2PCommon.sol";

/**
 * @dev Interface of the FinP2P protocol escrow operations.
 */
interface IFinP2PEscrow is IFinP2PCommon {

    struct LockInfo {
        string assetId;
        string amount;
    }

    event Hold(string assetId, string finId, string quantity, bytes16 operationId);
    event Release(string assetId, string sourceFinId, string destinationFinId, string quantity, bytes16 operationId);
    event Rollback(string assetId, string finId, string quantity, bytes16 operationId);

    function hold(bytes16 operationId, string memory nonce, string memory assetId, string memory sellerFinId,
        string memory buyerFinId, string memory quantity, string memory settlementAsset, string memory settlementAmount, bytes memory signature) external;

    function getLockInfo(bytes16 operationId) external view returns (LockInfo memory);

    function release(bytes16 operationId, string memory buyerFinId) external;

    function rollback(bytes16 operationId) external;

}