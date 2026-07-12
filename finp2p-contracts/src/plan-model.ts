import { PrimaryType, EIP712LoanTerms, emptyLoanTerms } from "./adapter-types";
import { Term } from "./model";

// TS mirrors of contracts/finp2p/PlanTypes.sol. Vocabulary aligned with the
// FinP2P Canton adapter's OrchestrationPlan (ExecutionVenue, ExecutionState,
// ApprovalState, OrchestrationPlan).

export enum PlanInstructionType {
  Issue = 0,
  Transfer = 1,
  Hold = 2,
  Release = 3,
  ReleaseAndRedeem = 4,
  Redeem = 5,
  Await = 6,
  RevertHold = 7
}

/** Where an instruction executes: this ledger or another one. */
export enum ExecutionVenue {
  OnLedger = 0,
  OffLedger = 1
}

/** State of a single instruction; Rejected marks compensated (reverted) holds. */
export enum ExecutionState {
  Pending = 0,
  Completed = 1,
  Rejected = 2
}

export enum ExecutionPlanStatus {
  None = 0,
  Pending = 1,
  Completed = 2,
  Rejected = 3,
  Reverted = 4
}

/** Per-organization stance on a plan (Canton: OrgApproval/ApprovalState). */
export enum ApprovalState {
  PendingApproval = 0,
  Approved = 1,
  ApprovalRejected = 2
}

export const NO_SIGNATURE = 255;

export type PlanInstruction = {
  sequence: number;
  instructionType: PlanInstructionType;
  venue: ExecutionVenue;
  organizationId: string;
  assetId: string;
  assetType: number; // model.AssetType (const enum)
  source: string;
  destination: string;
  amount: string;
  operationId: string;
  signatureIndex: number;
  state: ExecutionState;
};

export type PlanInvestmentSignature = {
  eip712PrimaryType: PrimaryType;
  nonce: string;
  buyerFinId: string;
  sellerFinId: string;
  asset: Term;
  settlement: Term;
  loan: EIP712LoanTerms;
  signerFinId: string;
  signature: string; // hex, 0x-prefixed
};

/** The on-chain projection of a FinP2P execution plan (Canton: OrchestrationPlanInfo). */
export type OrchestrationPlanInfo = {
  status: ExecutionPlanStatus;
  instructionCount: number;
  currentSequence: number;
};

/** Flat EIP-712 receipt proof as the contracts expect it (FinP2PReceiptVerifier.ReceiptProof). */
export type LedgerProof = {
  id: string;
  operationType: string;
  sourceAccountType: string;
  sourceFinId: string;
  destinationAccountType: string;
  destinationFinId: string;
  assetId: string;
  assetType: string; // "finp2p" | "fiat" | "cryptocurrency"
  executionPlanId: string;
  instructionSequenceNumber: string;
  operationId: string;
  transactionId: string;
  quantity: string;
};

export const planInstruction = (
  sequence: number,
  instructionType: PlanInstructionType,
  term: Term,
  opts: {
    venue?: ExecutionVenue,
    organizationId?: string,
    source?: string,
    destination?: string,
    operationId?: string,
    signatureIndex?: number
  } = {}
): PlanInstruction => ({
  sequence,
  instructionType,
  venue: opts.venue ?? ExecutionVenue.OnLedger,
  organizationId: opts.organizationId ?? "",
  assetId: term.assetId,
  assetType: term.assetType,
  source: opts.source ?? "",
  destination: opts.destination ?? "",
  amount: term.amount,
  operationId: opts.operationId ?? "",
  signatureIndex: opts.signatureIndex ?? NO_SIGNATURE,
  state: ExecutionState.Pending
});

export const planInvestmentSignature = (
  eip712PrimaryType: PrimaryType,
  nonce: string,
  buyerFinId: string,
  sellerFinId: string,
  asset: Term,
  settlement: Term,
  signerFinId: string,
  signature: string,
  loan: EIP712LoanTerms = emptyLoanTerms()
): PlanInvestmentSignature => ({
  eip712PrimaryType,
  nonce,
  buyerFinId,
  sellerFinId,
  asset,
  settlement,
  loan,
  signerFinId,
  signature: signature.startsWith("0x") ? signature : `0x${signature}`
});
