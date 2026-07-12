// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {PrimaryType} from "@owneraio/finp2p-ethereum-token-standard/contracts/OperationParams.sol";
import {FinP2PSignatureVerifier} from "../utils/finp2p/FinP2PSignatureVerifier.sol";

// Vocabulary aligned with the FinP2P Canton adapter's OrchestrationPlan
// (finp2p-canton-adapter/finp2p-contracts/daml/FinP2P/OrchestrationPlan.daml):
// ExecutionVenue ON_LEDGER/OFF_LEDGER, ExecutionState PENDING/COMPLETED/REJECTED,
// per-org ApprovalState. The EVM projection keeps a stricter model on top:
// a total-order cursor and cryptographic verification of investor intents and
// off-ledger completion proofs.

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

/// @notice Where an instruction executes: on this ledger (tracked atomically by
///         executeInstruction) or on another ledger (tracked via a verified
///         EIP-712 receipt proof in completeOffLedgerInstruction).
enum ExecutionVenue {
    ON_LEDGER,
    OFF_LEDGER
}

/// @notice State of a single instruction. COMPLETED covers both venues — the
///         venue (and the InstructionExecuted / OffLedgerInstructionCompleted
///         events) tell how completion happened. REJECTED marks instructions
///         compensated by revertPlan.
enum ExecutionState {
    PENDING,
    COMPLETED,
    REJECTED
}

/// @notice Plan lifecycle. PENDING/COMPLETED/REJECTED mirror the Canton plan
///         states; NONE marks an unknown plan and REVERTED a rejected plan
///         whose escrowed holds have been compensated.
enum PlanStatus {
    NONE,
    PENDING,
    COMPLETED,
    REJECTED,
    REVERTED
}

/// @notice Per-organization stance on a plan (Canton: OrgApproval/ApprovalState).
enum ApprovalState {
    PENDING_APPROVAL,
    APPROVED,
    APPROVAL_REJECTED
}

/// @dev Sentinel for `Instruction.signatureIndex` meaning "no investor signature required".
uint8 constant NO_SIGNATURE = 255;

/// @notice A single mirrored FinP2P execution-plan instruction.
/// @dev `organizationId` is only meaningful for `ExecutionVenue.OFF_LEDGER`:
///      it names the org whose registered proof signer must attest completion.
///      `operationId` links HOLD/RELEASE/RELEASE_AND_REDEEM/REVERT_HOLD instructions
///      to an escrow hold. `signatureIndex` points into the `SignaturePayload[]`
///      passed to `createPlan` (NO_SIGNATURE when the instruction needs none).
struct Instruction {
    uint8 sequence;
    InstructionType instructionType;
    ExecutionVenue venue;
    string organizationId;
    string assetId;
    FinP2PSignatureVerifier.AssetType assetType;
    string source;
    string destination;
    string amount;
    string operationId;
    uint8 signatureIndex;
    ExecutionState state;
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

/// @notice The on-chain projection of a FinP2P execution plan
///         (Canton: the OrchestrationPlan template).
struct OrchestrationPlan {
    PlanStatus status;
    uint8 instructionCount;
    uint8 currentSequence;
}
