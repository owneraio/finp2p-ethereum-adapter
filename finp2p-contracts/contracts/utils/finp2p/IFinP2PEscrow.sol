// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "./FinP2PSignatureVerifier.sol";
import "./IFinP2PCommon.sol";

/**
 * @dev Interface of the FinP2P protocol escrow operations.
 */
interface IFinP2PEscrow is IFinP2PCommon {



//    function holdAssets(bytes16 operationId, string memory nonce, string memory sellerFinId,
//        string memory buyerFinId, Term memory assetTerm, Term memory settlementTerm, bytes memory signature) external;
//
//    function holdPayments(bytes16 operationId, string memory nonce, string memory sellerFinId,
//        string memory buyerFinId, Term memory assetTerm, Term memory settlementTerm, bytes memory signature) external;
//
//    function getLockInfo(bytes16 operationId) external view returns (LockInfo memory);
//
//    function release(bytes16 operationId, string memory buyerFinId, string memory quantity) external;
//
//    function redeem(bytes16 operationId, string memory ownerFinId, string memory quantity) external;
//
//    function rollback(bytes16 operationId) external;

}