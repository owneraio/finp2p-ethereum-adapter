// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.0;

library FinP2P {

    enum Phase {
        INITIATE,
        CLOSE
    }

    enum ReleaseType {
        RELEASE,
        REDEEM
    }

    struct Domain {
        uint256 chainId;
        address verifyingContract;
    }

    struct OperationParams {
        Domain domain;
        PrimaryType primaryType;
        LegType leg;
        Phase phase;
        string operationId;
        ReleaseType releaseType;
    }

    enum AssetType {
        FINP2P,
        FIAT,
        CRYPTOCURRENCY
    }

    enum LegType {
        ASSET,
        SETTLEMENT
    }

    enum PrimaryType {
        PRIMARY_SALE,
        BUYING,
        SELLING,
        REDEMPTION,
        REQUEST_FOR_TRANSFER,
        PRIVATE_OFFER,
        LOAN
    }

    struct Term {
        string assetId;
        AssetType assetType;
        string amount;
    }

    struct LoanTerm {
        string openTime;
        string closeTime;
        string borrowedMoneyAmount;
        string returnedMoneyAmount;
    }

    struct Asset {
        string id;
        address tokenAddress;
    }

    struct Lock {
        string assetId;
        FinP2P.AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    struct LockInfo {
        string assetId;
        FinP2P.AssetType assetType;
        string source;
        string destination;
        string amount;
    }

    enum ExecutionStatus {
        NONE,
        CREATED,
        VERIFIED,
        EXECUTED,
        FAILED
    }

    enum OperationType {
        ISSUE,
        TRANSFER,
        HOLD,
        RELEASE,
        REDEEM
    }

    function requireInvestorSignature(OperationType op) internal pure returns (bool) {
        if (op == OperationType.TRANSFER || op == OperationType.HOLD) {
            return true;
        }
        return false;
    }

    enum InstructionStatus {
        REQUIRE_INVESTOR_SIGNATURE,
        PENDING,
        EXECUTED,
        FAILED
    }

    enum InstructionExecutor {
        THIS_CONTRACT,
        OTHER_CONTRACT
    }

    struct Instruction {
        uint8 sequence;
        OperationType operation;
        string assetId;
        FinP2P.AssetType assetType;
        string source;
        string destination;
        string amount;
        InstructionExecutor executor;
        InstructionStatus status;
        string proofSigner;
    }

    struct ExecutionContext {
        string id;
        PrimaryType primaryType;
        ExecutionStatus status;
        uint8 currentInstruction;
        Instruction[] instructions;
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

/// @notice Issue event
/// @param assetId The asset id
/// @param assetType The asset type
/// @param issuerFinId The FinID of the issuer
/// @param quantity The quantity issued
    event Issue(string assetId, FinP2P.AssetType assetType, string issuerFinId, string quantity);

/// @notice Transfer event
/// @param assetId The asset id
/// @param assetType The asset type
/// @param sourceFinId The FinID of the source
/// @param destinationFinId The FinID of the destination
/// @param quantity The quantity transferred
    event Transfer(string assetId, FinP2P.AssetType assetType, string sourceFinId, string destinationFinId, string quantity);

/// @notice Hold event
/// @param assetId The asset id
/// @param assetType The asset type
/// @param finId The FinID of the holder
/// @param quantity The quantity held
/// @param operationId The operation id
    event Hold(string assetId, FinP2P.AssetType assetType, string finId, string quantity, string operationId);

/// @notice Release event
/// @param assetId The asset id
/// @param assetType The asset type
/// @param sourceFinId The FinID of the source
/// @param destinationFinId The FinID of the destination
/// @param quantity The quantity released
/// @param operationId The operation id
    event Release(string assetId, FinP2P.AssetType assetType, string sourceFinId, string destinationFinId, string quantity, string operationId);

/// @notice Redeem event
/// @param assetId The asset id
/// @param assetType The asset type
/// @param ownerFinId The FinID of the owner
/// @param quantity The quantity redeemed
/// @param operationId The operation id
    event Redeem(string assetId, FinP2P.AssetType assetType, string ownerFinId, string quantity, string operationId);

}