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

export type SuccessfulAssetCreationResult = {
  type: "success";
  tokenId: string;
  tokenAddress: string;
  finp2pTokenAddress: string;
}

export type FailedAssetCreationResult = {
  type: "failure";
  error: ErrorDetails
}

export type AssetCreationResult = SuccessfulAssetCreationResult | FailedAssetCreationResult;

export const failedAssetCreation = (code: number, message: string): AssetCreationResult => ({
  type: "failure",
  error: { code, message }
});

export const successfulAssetCreation = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string): AssetCreationResult => ({
  type: "success",
  tokenId,
  tokenAddress,
  finp2pTokenAddress
});

export type PendingReceiptResult = {
  type: "pending";
  correlationId: string;
};

export type FailedReceiptResult = {
  type: "failure";
  error: ErrorDetails
}

export type SuccessReceiptResult = {
  type: "success";
  receipt: Receipt;
}

export type ReceiptResult = PendingReceiptResult | FailedReceiptResult | SuccessReceiptResult;

export type OperationResult = ReceiptResult | AssetCreationResult;

export const successfulReceiptResult = (receipt: Receipt): ReceiptResult => ({
  type: "success",
  receipt
});

export const failedReceiptResult = (code: number, message: string): ReceiptResult => ({
  type: "failure",
  error: { code, message }
});

export const pendingReceiptResult = (correlationId: string): ReceiptResult => ({
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
  tradeDetails: TradeDetails | undefined,
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

export type ProofPolicy = {}

export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}


export type EIP712Domain = {}


export type EIP712Template = {
  type: "EIP712"
  primaryType: string;
  message: EIP722Message;
};


export type EIP722Message = {
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
