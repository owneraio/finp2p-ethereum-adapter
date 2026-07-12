// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {PrimaryType} from "@owneraio/finp2p-ethereum-token-standard/contracts/OperationParams.sol";
import {FinP2PSignatureVerifier} from "../../utils/finp2p/FinP2PSignatureVerifier.sol";

enum InstructionType {
    ISSUE,
    TRANSFER,
    HOLD,
    RELEASE,
    RELEASE_AND_REDEEM,
    REDEEM,
    AWAIT,
    REVERT_HOLD
}

enum InstructionExecutor {
    THIS_CONTRACT,
    OTHER_LEDGER
}

enum InstructionStatus {
    PENDING,
    EXECUTED,
    PROVEN,
    ROLLED_BACK
}

enum PlanStatus {
    NONE,
    CREATED,
    EXECUTING,
    COMPLETED,
    FAILED,
    REVERTED
}

/// @dev Sentinel for `Instruction.signatureIndex` meaning "no investor signature required".
uint8 constant NO_SIGNATURE = 255;

/// @notice A single mirrored FinP2P execution-plan instruction.
/// @dev `organizationId` is only meaningful for `InstructionExecutor.OTHER_LEDGER`:
///      it names the org whose registered proof signer must attest completion.
///      `operationId` links HOLD/RELEASE/RELEASE_AND_REDEEM/REVERT_HOLD instructions
///      to an escrow hold. `signatureIndex` points into the `SignaturePayload[]`
///      passed to `createPlan` (NO_SIGNATURE when the instruction needs none).
struct Instruction {
    uint8 sequence;
    InstructionType instructionType;
    InstructionExecutor executor;
    string organizationId;
    string assetId;
    FinP2PSignatureVerifier.AssetType assetType;
    string source;
    string destination;
    string amount;
    string operationId;
    uint8 signatureIndex;
    InstructionStatus status;
}

/// @notice One investor intent (EIP-712 investment message + signature) covering
///         both legs of a trade. Verified at plan creation, never stored.
struct SignaturePayload {
    PrimaryType eip712PrimaryType;
    string nonce;
    string buyerFinId;
    string sellerFinId;
    FinP2PSignatureVerifier.Term asset;
    FinP2PSignatureVerifier.Term settlement;
    FinP2PSignatureVerifier.LoanTerm loan;
    string signerFinId;
    bytes signature;
}

struct ExecutionPlan {
    PlanStatus status;
    uint8 instructionCount;
    uint8 currentSequence;
}
