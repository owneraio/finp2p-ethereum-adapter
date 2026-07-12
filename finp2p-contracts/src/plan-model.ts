import { PrimaryType, EIP712LoanTerms, emptyLoanTerms } from "./adapter-types";
import { Term } from "./model";

// TS mirrors of contracts/finp2p/v2/PlanTypes.sol

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

export enum InstructionExecutor {
  ThisContract = 0,
  OtherLedger = 1
}

export enum PlanInstructionStatus {
  Pending = 0,
  Executed = 1,
  Proven = 2,
  RolledBack = 3
}

export enum ExecutionPlanStatus {
  None = 0,
  Created = 1,
  Executing = 2,
  Completed = 3,
  Failed = 4,
  Reverted = 5
}

export const NO_SIGNATURE = 255;

export type PlanInstruction = {
  sequence: number;
  instructionType: PlanInstructionType;
  executor: InstructionExecutor;
  organizationId: string;
  assetId: string;
  assetType: number; // model.AssetType (const enum)
  source: string;
  destination: string;
  amount: string;
  operationId: string;
  signatureIndex: number;
  status: PlanInstructionStatus;
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

export type ExecutionPlanState = {
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
    executor?: InstructionExecutor,
    organizationId?: string,
    source?: string,
    destination?: string,
    operationId?: string,
    signatureIndex?: number
  } = {}
): PlanInstruction => ({
  sequence,
  instructionType,
  executor: opts.executor ?? InstructionExecutor.ThisContract,
  organizationId: opts.organizationId ?? "",
  assetId: term.assetId,
  assetType: term.assetType,
  source: opts.source ?? "",
  destination: opts.destination ?? "",
  amount: term.amount,
  operationId: opts.operationId ?? "",
  signatureIndex: opts.signatureIndex ?? NO_SIGNATURE,
  status: PlanInstructionStatus.Pending
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
