export type AssetType = "finp2p" | "fiat" | "cryptocurrency";

export type Asset = {
  assetId: string
  assetType: AssetType
}

export type Source = {
  finId: string
}

export const finIdSource = (finId: string | undefined): Source | undefined => {
  if (!finId) {
    return undefined;
  }
  return { finId };
};

export type Destination = {
  finId: string
}

export const finIdDestination = (finId: string | undefined): Destination | undefined => {
  if (!finId) {
    return undefined;
  }
  return { finId };
};

export type Signature = {
  signature: string;
  template: SignatureTemplate;
}

export type SignatureTemplate = EIP712Template


export type ExecutionContext = {
  planId: string
  sequence: number
}

export type ErrorDetails = {
  code: number;
  message: string;
}

export type PlanApprovalStatus = ApprovedPlan | RejectedPlan | PendingPlan;

export type ApprovedPlan = {
  type: "approved";
}

export type RejectedPlan = {
  type: "rejected";
  error: ErrorDetails
}

export type PendingPlan = {
  type: "pending";
  correlationId: string;
}

export const approvedPlan = (): PlanApprovalStatus => ({
  type: "approved"
});

export const rejectedPlan = (code: number, message: string): PlanApprovalStatus => ({
  type: "rejected",
  error: { code, message }
});

export const pendingPlan = (correlationId: string): PlanApprovalStatus => ({
  type: "pending",
  correlationId
});

export type SuccessfulAssetCreation = {
  type: "success";
  tokenId: string;
  tokenAddress: string;
  finp2pTokenAddress: string;
}

export type FailedAssetCreation = {
  type: "failure";
  error: ErrorDetails
}

export type PendingAssetCreation = {
  type: "pending";
  correlationId: string;
}


export type AssetCreationStatus = SuccessfulAssetCreation | FailedAssetCreation | PendingAssetCreation;

export const failedAssetCreation = (code: number, message: string): AssetCreationStatus => ({
  type: "failure",
  error: { code, message }
});

export const successfulAssetCreation = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string): AssetCreationStatus => ({
  type: "success",
  tokenId,
  tokenAddress,
  finp2pTokenAddress
});

export const pendingAssetCreation = (correlationId: string): AssetCreationStatus => ({
  type: "pending",
  correlationId
});

export type PendingReceiptStatus = {
  type: "pending";
  correlationId: string;
};

export type FailedReceiptStatus = {
  type: "failure";
  error: ErrorDetails
}

export type SuccessReceiptStatus = {
  type: "success";
  receipt: Receipt;
}


export type ReceiptOperation = PendingReceiptStatus | FailedReceiptStatus | SuccessReceiptStatus;

export type OperationStatus = ReceiptOperation | AssetCreationStatus;

export const successfulReceiptOperation = (receipt: Receipt): ReceiptOperation => ({
  type: "success",
  receipt
});

export const failedReceiptOperation = (code: number, message: string): ReceiptOperation => ({
  type: "failure",
  error: { code, message }
});

export const pendingReceiptOperation = (correlationId: string): ReceiptOperation => ({
  type: "pending",
  correlationId
});


export type DepositInstruction = {}

export type DepositOperation = SuccessfulDepositOperation | FailedDepositOperation | PendingDepositOperation;

export type SuccessfulDepositOperation = {
  type: "success";
  instruction: DepositInstruction
}

export type FailedDepositOperation = {
  type: "failure";
  error: ErrorDetails
}

export type PendingDepositOperation = {
  type: "pending";
  correlationId: string;
}

const successfulDepositOperation = (instruction: DepositInstruction): DepositOperation => ({
  type: "success",
  instruction
});

const failedDepositOperation = (code: number, message: string): DepositOperation => ({
  type: "failure",
  error: { code, message }
});

const pendingDepositOperation = (correlationId: string): DepositOperation => ({
  type: "pending",
  correlationId
});


export type Balance = {
  current: string
  available: string
  held: string
}

export type OperationType = "transfer" | "redeem" | "hold" | "release" | "issue";

export type Receipt = {
  id: string,
  asset: Asset
  source: Source | undefined,
  destination: Destination | undefined,
  quantity: string,
  transactionDetails: TransactionDetails
  tradeDetails: TradeDetails,
  operationType: OperationType,
  proof: ProofPolicy | undefined,
  timestamp: number
}

export type TransactionDetails = {
  transactionId: string
  operationId: string | undefined
}

export type TradeDetails = {
  executionContext: ExecutionContext | undefined
}

export type ProofPolicy = NoProofPolicy | SignatureProofPolicy

export type NoProofPolicy = {
  type: "no-proof"
}

export type SignatureProofPolicy = {
  type: "signature-proof";
  template: EIP712Template
  signature: string
}

export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}


export type EIP712Domain = {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
}


export type EIP712Template = {
  type: "EIP712"
  primaryType: string;
  domain: EIP712Domain;
  message: EIP712Message;
  types: EIP712Types
  hash: string
};

export type EIP712Message = {
  [name: string]: EIP712TypedValue;
}

export type EIP712TypeArray = EIP712TypedValue[];
export type EIP712TypeBool = boolean;
export type EIP712TypeByte = string;
export type EIP712TypeInteger = number;

export interface EIP712TypeObject {
  [name: string]: EIP712TypedValue;
}

export type EIP712TypeString = string;

export type EIP712TypedValue =
  EIP712TypeString
  | EIP712TypeInteger
  | EIP712TypeBool
  | EIP712TypeByte
  | EIP712TypeObject
  | EIP712TypeArray;

export type EIP712Types = {
  [name: string]: EIP712TypeDefinition[];
}

export interface EIP712TypeDefinition {
  name?: string;
  fields?: EIP712FieldDefinition[];
}

export interface EIP712FieldDefinition {
  name?: string;
  type?: string;
}

