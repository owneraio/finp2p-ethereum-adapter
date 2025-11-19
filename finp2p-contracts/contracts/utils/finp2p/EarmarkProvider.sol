// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

import "../StringUtils.sol";
import {EIP712} from "./EIP712.sol";
import {FinIdUtils} from "./FinIdUtils.sol";
import {Signature} from "./Signature.sol";

contract EarmarkProvider is EIP712 {

    using FinIdUtils for string;
    using StringUtils for string;

    mapping(uint256 => Earmark) private earmarks;

    constructor() EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {
    }

    struct Earmark {
        ReceiptOperationType operationType;
        string assetId;
        AssetType assetType;
        string amount;
        string source;
        string destination;
        string proofSignerFinId;
    }

    struct ReceiptProof {
        string id;
        ReceiptOperationType operation;
        ReceiptSource source;
        ReceiptDestination destination;
        ReceiptAsset asset;
        ReceiptTradeDetails tradeDetails;
        ReceiptTransactionDetails transactionDetails;
        string quantity;
        bytes signature;
    }

    enum ReceiptOperationType {
        ISSUE,
        TRANSFER,
        HOLD,
        RELEASE,
        REDEEM
    }

    struct ReceiptSource {
        string accountType;
        string finId;
    }

    struct ReceiptDestination {
        string accountType;
        string finId;
    }

    struct ReceiptAsset {
        AssetType assetType;
        string assetId;
    }

    struct ReceiptExecutionContext {
        string executionPlanId;
        uint8 instructionSequenceNumber;
    }

    struct ReceiptTradeDetails {
        ReceiptExecutionContext executionContext;
    }

    struct ReceiptTransactionDetails {
        string operationId;
        string transactionId;
    }

    enum AssetType {
        FINP2P,
        FIAT,
        CRYPTOCURRENCY
    }

    string private constant SIGNING_DOMAIN = "FinP2P";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant RECEIPT_TYPE_HASH = keccak256(
        "Receipt(string id,string operationType,Source source,Destination destination,Asset asset,TradeDetails tradeDetails,TransactionDetails transactionDetails,string quantity)"
        "Asset(string assetId,string assetType)"
        "Destination(string accountType,string finId)"
        "ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
        "Source(string accountType,string finId)"
        "TradeDetails(ExecutionContext executionContext)"
        "TransactionDetails(string operationId,string transactionId)"
    );

    bytes32 private constant FINID_TYPE_HASH = keccak256(
        "FinId(string idkey)"
    );

    bytes32 private constant TERM_TYPE_HASH = keccak256(
        "Term(string assetId,string assetType,string amount)"
    );

    bytes32 private constant LOAN_TERMS_TYPE_HASH = keccak256(
        "LoanTerms(string openTime,string closeTime,string borrowedMoneyAmount,string returnedMoneyAmount)"
    );

    bytes32 private constant ASSET_TYPE_HASH = keccak256(
        "Asset(string assetId,string assetType)"
    );

    bytes32 private constant SOURCE_TYPE_HASH = keccak256(
        "Source(string accountType,string finId)"
    );

    bytes32 private constant DESTINATION_TYPE_HASH = keccak256(
        "Destination(string accountType,string finId)"
    );

    bytes32 private constant TRADE_DETAILS_TYPE_HASH = keccak256(
        "TradeDetails(ExecutionContext executionContext)"
        "ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
    );

    bytes32 private constant EXECUTION_CONTEXT_TYPE_HASH = keccak256(
        "ExecutionContext(string executionPlanId,string instructionSequenceNumber)"
    );

    bytes32 private constant TRANSACTION_DETAILS_TYPE_HASH = keccak256(
        "TransactionDetails(string operationId,string transactionId)"
    );

    bytes32 private constant ASSET_TYPE_FINP2P_HASH = keccak256("finp2p");
    bytes32 private constant ASSET_TYPE_FIAT_HASH = keccak256("fiat");
    bytes32 private constant ASSET_TYPE_CRYPTOCURRENCY_HASH = keccak256("cryptocurrency");

    bytes32 private constant OPERATION_ISSUE_HASH = keccak256("issue");
    bytes32 private constant OPERATION_TRANSFER_HASH = keccak256("transfer");
    bytes32 private constant OPERATION_REDEEM_HASH = keccak256("redeem");
    bytes32 private constant OPERATION_HOLD_HASH = keccak256("hold");
    bytes32 private constant OPERATION_RELEASE_HASH = keccak256("release");

    function storeEarmark(uint256 lockId, Earmark memory earmark) public {
        earmarks[lockId] = earmark;
    }

    function getEarmark(uint256 lockId) public view returns (Earmark memory) {
        return earmarks[lockId];
    }

    function validateEarmarkProof(
        uint256 lockId,
        ReceiptProof memory proof
    ) public view {
        Earmark memory earmark = getEarmark(lockId);
        require(earmark.operationType == proof.operation, "Operation does not match");
        require(earmark.assetId.equals(proof.asset.assetId), "Asset id does not match");
        require(earmark.assetType == proof.asset.assetType, "Asset type does not match");
        require(earmark.amount.equals(proof.quantity), "Quantity does not match");
        require(earmark.source.equals(proof.source.finId), "Source does not match");
        require(earmark.destination.equals(proof.destination.finId), "Destination does not match");
        require(verifyReceiptProofSignature(proof, earmark.proofSignerFinId), "Receipt proof signature is not verified");
    }

    // ------------------------ Internal functions ------------------------

    function verifyReceiptProofSignature(ReceiptProof memory proof, string memory signerFinId) internal view returns (bool) {
        bytes32 hash = hashReceipt(proof.id, proof.operation, proof.source, proof.destination, proof.asset,
            proof.tradeDetails, proof.transactionDetails, proof.quantity);
        return Signature.verify(signerFinId.toAddress(), hash, proof.signature);
    }


    function hashReceipt(
        string memory id,
        ReceiptOperationType operationType,
        ReceiptSource memory source,
        ReceiptDestination memory destination,
        ReceiptAsset memory asset,
        ReceiptTradeDetails memory tradeDetails,
        ReceiptTransactionDetails memory transactionDetails,
        string memory quantity
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(
                RECEIPT_TYPE_HASH,
                keccak256(bytes(id)),
                hashOperationType(operationType),
                hashSource(source),
                hashDestination(destination),
                hashAsset(asset),
                hashTradeDetails(tradeDetails),
                hashTransactionDetails(transactionDetails),
                keccak256(bytes(quantity))
            ))
        );
    }


    function hashFinId(string memory finId) internal pure returns (bytes32) {
        return keccak256(abi.encode(FINID_TYPE_HASH, keccak256(bytes(finId))));
    }

    function hashAssetType(AssetType assetType) internal pure returns (bytes32) {
        if (assetType == AssetType.FINP2P) {
            return ASSET_TYPE_FINP2P_HASH;
        } else if (assetType == AssetType.FIAT) {
            return ASSET_TYPE_FIAT_HASH;
        } else if (assetType == AssetType.CRYPTOCURRENCY) {
            return ASSET_TYPE_CRYPTOCURRENCY_HASH;
        } else {
            revert("Invalid asset type");
        }
    }

    function hashAsset(ReceiptAsset memory asset) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            ASSET_TYPE_HASH,
            keccak256(bytes(asset.assetId)),
            hashAssetType(asset.assetType)
        ));
    }

    function hashSource(ReceiptSource memory source) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            SOURCE_TYPE_HASH,
            keccak256(bytes(source.accountType)),
            keccak256(bytes(source.finId))
        ));
    }

    function hashDestination(ReceiptDestination memory destination) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            DESTINATION_TYPE_HASH,
            keccak256(bytes(destination.accountType)),
            keccak256(bytes(destination.finId))
        ));
    }


    function hashUint8AsString(uint8 value) internal pure returns (bytes32) {
        require(value >= 1 && value <= 9, "Value must be between 1 and 9");
        return keccak256(abi.encodePacked(bytes1(uint8(48 + value))));
    }

    function hashExecutionContext(ReceiptExecutionContext memory exCtx) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            EXECUTION_CONTEXT_TYPE_HASH,
            keccak256(bytes(exCtx.executionPlanId)),
            hashUint8AsString(exCtx.instructionSequenceNumber)
        ));
    }

    function hashTradeDetails(ReceiptTradeDetails memory details) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            TRADE_DETAILS_TYPE_HASH,
            hashExecutionContext(details.executionContext)
        ));
    }

    function hashTransactionDetails(ReceiptTransactionDetails memory details) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            TRANSACTION_DETAILS_TYPE_HASH,
            keccak256(bytes(details.operationId)),
            keccak256(bytes(details.transactionId))
        ));
    }

    function hashOperationType(ReceiptOperationType op) internal pure returns (bytes32) {
        if (op == ReceiptOperationType.ISSUE) {
            return OPERATION_ISSUE_HASH;
        } else if (op == ReceiptOperationType.TRANSFER) {
            return OPERATION_TRANSFER_HASH;
        } else if (op == ReceiptOperationType.REDEEM) {
            return OPERATION_REDEEM_HASH;
        } else if (op == ReceiptOperationType.HOLD) {
            return OPERATION_HOLD_HASH;
        } else if (op == ReceiptOperationType.RELEASE) {
            return OPERATION_RELEASE_HASH;
        } else {
            revert("Invalid operation type");
        }
    }


}
