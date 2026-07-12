// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {FinP2PSignatureVerifier} from "./FinP2PSignatureVerifier.sol";
import {Signature} from "./Signature.sol";

/**
 * @dev Adds on-chain verification of FinP2P receipt proofs ("earmarks"): EIP-712
 * `Receipt` messages signed by another ledger's proof signer to attest that an
 * instruction completed there. The type layout mirrors the off-chain
 * RECEIPT_PROOF_TYPES schema (src/adapter-types.ts) byte-for-byte, over the same
 * chain-agnostic FinP2P domain, so proofs produced by remote adapters verify here
 * without any new signing flow.
 */
contract FinP2PReceiptVerifier is FinP2PSignatureVerifier {

    struct ReceiptProof {
        string id;
        string operationType;
        string sourceAccountType;
        string sourceFinId;
        string destinationAccountType;
        string destinationFinId;
        string assetId;
        string assetType;
        string executionPlanId;
        string instructionSequenceNumber;
        string operationId;
        string transactionId;
        string quantity;
    }

    bytes32 private constant RECEIPT_TYPE_HASH = keccak256(
        "Receipt(string id,string operationType,Source source,Destination destination,Asset asset,TradeDetails tradeDetails,TransactionDetails transactionDetails,string quantity)"
        "Asset(string assetId,string assetType)"
        "Destination(string accountType,string finId)"
        "ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
        "Source(string accountType,string finId)"
        "TradeDetails(ExecutionContext executionContext)"
        "TransactionDetails(string operationId,string transactionId)"
    );

    bytes32 private constant RECEIPT_SOURCE_TYPE_HASH = keccak256(
        "Source(string accountType,string finId)"
    );

    bytes32 private constant RECEIPT_DESTINATION_TYPE_HASH = keccak256(
        "Destination(string accountType,string finId)"
    );

    bytes32 private constant RECEIPT_ASSET_TYPE_HASH = keccak256(
        "Asset(string assetId,string assetType)"
    );

    bytes32 private constant RECEIPT_EXECUTION_CONTEXT_TYPE_HASH = keccak256(
        "ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
    );

    bytes32 private constant RECEIPT_TRADE_DETAILS_TYPE_HASH = keccak256(
        "TradeDetails(ExecutionContext executionContext)ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
    );

    bytes32 private constant RECEIPT_TRANSACTION_DETAILS_TYPE_HASH = keccak256(
        "TransactionDetails(string operationId,string transactionId)"
    );

    function hashReceipt(ReceiptProof memory receipt) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            RECEIPT_TYPE_HASH,
            keccak256(bytes(receipt.id)),
            keccak256(bytes(receipt.operationType)),
            keccak256(abi.encode(
                RECEIPT_SOURCE_TYPE_HASH,
                keccak256(bytes(receipt.sourceAccountType)),
                keccak256(bytes(receipt.sourceFinId))
            )),
            keccak256(abi.encode(
                RECEIPT_DESTINATION_TYPE_HASH,
                keccak256(bytes(receipt.destinationAccountType)),
                keccak256(bytes(receipt.destinationFinId))
            )),
            keccak256(abi.encode(
                RECEIPT_ASSET_TYPE_HASH,
                keccak256(bytes(receipt.assetId)),
                keccak256(bytes(receipt.assetType))
            )),
            keccak256(abi.encode(
                RECEIPT_TRADE_DETAILS_TYPE_HASH,
                keccak256(abi.encode(
                    RECEIPT_EXECUTION_CONTEXT_TYPE_HASH,
                    keccak256(bytes(receipt.executionPlanId)),
                    keccak256(bytes(receipt.instructionSequenceNumber))
                ))
            )),
            keccak256(abi.encode(
                RECEIPT_TRANSACTION_DETAILS_TYPE_HASH,
                keccak256(bytes(receipt.operationId)),
                keccak256(bytes(receipt.transactionId))
            )),
            keccak256(bytes(receipt.quantity))
        )));
    }

    function verifyReceiptProofSignature(
        ReceiptProof memory receipt,
        address signer,
        bytes memory signature
    ) public view returns (bool) {
        return Signature.verify(signer, hashReceipt(receipt), signature);
    }

    /// @notice Recover the proof signer from a receipt signature.
    /// @dev Accepts 65-byte (r,s,v) and 64-byte EIP-2098 compact (r,vs) signatures.
    function recoverReceiptProofSigner(
        ReceiptProof memory receipt,
        bytes memory signature
    ) public view returns (address) {
        bytes32 hash = hashReceipt(receipt);
        if (signature.length == 65) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
            require(err == ECDSA.RecoverError.NoError, "Invalid receipt proof signature");
            return recovered;
        } else if (signature.length == 64) {
            bytes32 r;
            bytes32 vs;
            assembly {
                r := mload(add(signature, 0x20))
                vs := mload(add(signature, 0x40))
            }
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, r, vs);
            require(err == ECDSA.RecoverError.NoError, "Invalid receipt proof signature");
            return recovered;
        } else {
            revert("Invalid receipt proof signature length");
        }
    }
}
