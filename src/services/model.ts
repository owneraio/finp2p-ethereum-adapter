export type AssetType = "finp2p" | "fiat" | "cryptocurrency";

export type Asset = {
  assetId: string
  assetType: AssetType
}

export type DepositAsset = Asset | {
  assetType: 'custom'
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
  operation: "approval",
  type: "approved";
}

export type RejectedPlan = {
  operation: "approval",
  type: "rejected";
  error: ErrorDetails
}

export type PendingPlan = {
  operation: "approval",
  type: "pending";
  correlationId: string;
}

export const approvedPlan = (): PlanApprovalStatus => ({
  operation: "approval",
  type: "approved"
});

export const rejectedPlan = (code: number, message: string): PlanApprovalStatus => ({
  operation: "approval",
  type: "rejected",
  error: { code, message }
});

export const pendingPlan = (correlationId: string): PlanApprovalStatus => ({
  operation: "approval",
  type: "pending",
  correlationId
});

export type SuccessfulAssetCreation = {
  operation: "createAsset",
  type: "success";
  tokenId: string;
  tokenAddress: string;
  finp2pTokenAddress: string;
}

export type FailedAssetCreation = {
  operation: "createAsset",
  type: "failure";
  error: ErrorDetails
}

export type PendingAssetCreation = {
  operation: "createAsset",
  type: "pending";
  correlationId: string;
}


export type AssetCreationStatus = SuccessfulAssetCreation | FailedAssetCreation | PendingAssetCreation;

export const failedAssetCreation = (code: number, message: string): AssetCreationStatus => ({
  operation: "createAsset",
  type: "failure",
  error: { code, message }
});

export const successfulAssetCreation = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string): AssetCreationStatus => ({
  operation: "createAsset",
  type: "success",
  tokenId,
  tokenAddress,
  finp2pTokenAddress
});

export const pendingAssetCreation = (correlationId: string): AssetCreationStatus => ({
  operation: "createAsset",
  type: "pending",
  correlationId
});

export type PendingReceiptStatus = {
  operation: "receipt",
  type: "pending";
  correlationId: string;
};

export type FailedReceiptStatus = {
  operation: "receipt",
  type: "failure";
  error: ErrorDetails
}

export type SuccessReceiptStatus = {
  operation: "receipt",
  type: "success";
  receipt: Receipt;
}

export type ReceiptOperation = PendingReceiptStatus | FailedReceiptStatus | SuccessReceiptStatus;

export type OperationStatus = ReceiptOperation | AssetCreationStatus | DepositOperation | PlanApprovalStatus;

export const successfulReceiptOperation = (receipt: Receipt): ReceiptOperation => ({
  operation: "receipt",
  type: "success",
  receipt
});

export const failedReceiptOperation = (code: number, message: string): ReceiptOperation => ({
  operation: "receipt",
  type: "failure",
  error: { code, message }
});

export const pendingReceiptOperation = (correlationId: string): ReceiptOperation => ({
  operation: "receipt",
  type: "pending",
  correlationId
});


export type DepositInstruction = {
  account: Destination
  description: string
  paymentMethods: {}
  operationId: string | undefined
  details: any | undefined
}

export type DepositOperation = SuccessfulDepositOperation | FailedDepositOperation | PendingDepositOperation;

export type SuccessfulDepositOperation = {
  operation: "deposit",
  type: "success";
  instruction: DepositInstruction
}

export type FailedDepositOperation = {
  operation: "deposit",
  type: "failure";
  error: ErrorDetails
}

export type PendingDepositOperation = {
  operation: "deposit",
  type: "pending";
  correlationId: string;
}

export const successfulDepositOperation = (instruction: DepositInstruction): DepositOperation => ({
  operation: "deposit",
  type: "success",
  instruction
});

export const failedDepositOperation = (code: number, message: string): DepositOperation => ({
  operation: "deposit",
  type: "failure",
  error: { code, message }
});

export const pendingDepositOperation = (correlationId: string): DepositOperation => ({
  operation: "deposit",
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

