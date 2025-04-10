import {
  eip712Asset,
  EIP712ReceiptMessage,
  EIP712Template,
  eip712ExecutionContext, LegType, PrimaryType,
  eip712TradeDetails,
  eip712TransactionDetails, EIP712Term, EIP712AssetType
} from "./eip712";

export interface Term {
  assetId: string,
  assetType: AssetType,
  amount: string
}

export const enum AssetType {
  FinP2P = 0,
  Fiat = 1,
  Cryptocurrency = 2
}

export const enum CollateralBasketState {
  CREATED,
  DEPOSITED,
  RELEASED
}

export const assetTypeFromNumber = (assetType: bigint): AssetType => {
  switch (assetType) {
    case 0n:
      return AssetType.FinP2P;
    case 1n:
      return AssetType.Fiat;
    case 2n:
      return AssetType.Cryptocurrency;
    default:
      throw new Error("Invalid asset type");
  }
};

export const assetTypeFromString = (assetType: string): AssetType => {
  switch (assetType) {
    case "finp2p":
      return AssetType.FinP2P;
    case "fiat":
      return AssetType.Fiat;
    case "cryptocurrency":
      return AssetType.Cryptocurrency;
    default:
      throw new Error("Invalid asset type");
  }
};

export const term = (assetId: string, assetType: AssetType, amount: string): Term => {
  return { assetId, assetType, amount };
};

export const emptyTerm = (): Term => {
  return term("", 0, "");
};

export const assetTypeToEIP712 = (assetType: AssetType): EIP712AssetType => {
  switch (assetType) {
    case AssetType.FinP2P:
      return "finp2p";
    case AssetType.Fiat:
      return "fiat";
    case AssetType.Cryptocurrency:
      return "cryptocurrency";
  }
};

export const termToEIP712 = (term: Term): EIP712Term => {
  return {
    assetId: term.assetId,
    assetType: assetTypeToEIP712(term.assetType),
    amount: term.amount
  };
};

export const enum Phase {
  Initiate = 0,
  Close = 1
}

export const enum ReleaseType {
  Release = 0,
  Redeem = 1
}

export interface OperationParams {
  domain: {
    chainId: number | bigint
    verifyingContract: string
  };
  primaryType: PrimaryType;
  leg: LegType;
  phase: Phase;
  operationId: string;
  releaseType: ReleaseType;
}

export const operationParams = (
  domain: {
    chainId: number | bigint,
    verifyingContract: string
  },
  primaryType: PrimaryType,
  leg: LegType,
  phase: Phase = Phase.Initiate,
  operationId: string = "",
  releaseType: ReleaseType = ReleaseType.Release): OperationParams => {
  return {
    domain,
    primaryType,
    leg,
    phase,
    operationId,
    releaseType
  };
};

export type OperationStatus = PendingTransaction | SuccessfulTransaction | FailedTransaction;

export type PendingTransaction = {
  status: "pending"
};

export type SuccessfulTransaction = {
  status: "completed"
  receipt: FinP2PReceipt
};

export const pendingOperation = (): PendingTransaction => {
  return {
    status: "pending"
  };
};

export const completedOperation = (receipt: FinP2PReceipt): SuccessfulTransaction => {
  return {
    status: "completed",
    receipt
  };
};

export const failedOperation = (message: string, code: number): FailedTransaction => {
  return {
    status: "failed",
    error: { code, message }
  };
};

export type TradeDetails = {
  executionContext: ExecutionContext
}

export type ExecutionContext = {
  executionPlanId: string
  instructionSequenceNumber: number
}

export type ReceiptProof = {
  type: "no-proof"
} | {
  type: "signature-proof",
  template: EIP712Template
  signature: string
}

export const receiptToEIP712Message = (receipt: FinP2PReceipt): EIP712ReceiptMessage => {
  const { id, operationType, assetId, assetType, quantity, source, destination, operationId } = receipt;
  return {
    id,
    operationType,
    source: { accountType: source ? "finId" : "", finId: source || "" },
    destination: { accountType: destination ? "finId" : "", finId: destination || "" },
    quantity,
    asset: eip712Asset(assetId, assetTypeToEIP712(assetType)),
    tradeDetails: eip712TradeDetails(eip712ExecutionContext(
      receipt?.tradeDetails?.executionContext.executionPlanId || "",
      `${receipt?.tradeDetails?.executionContext.instructionSequenceNumber || ""}`)),
    transactionDetails: eip712TransactionDetails(operationId || "", id)
  };
};

export type OperationType = "transfer" | "redeem" | "hold" | "release" | "issue";

export type FinP2PReceipt = {
  id: string
  assetId: string
  assetType: AssetType
  quantity: string
  source?: string
  destination?: string
  timestamp: number
  operationType: OperationType
  operationId?: string
  tradeDetails?: TradeDetails
  proof?: ReceiptProof
};

export type ERC20Transfer = {
  tokenAddress: string
  from: string
  to: string
  amount: number
}

export type FailedTransaction = {
  status: "failed"
  error: TransactionError
};

export type TransactionError = {
  code: number
  message: string
};

export class EthereumTransactionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceToHighError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceAlreadyBeenUsedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export const enum HashType {
  HashList = 1,
  EIP712 = 2
}

export const detectError = (e: any): EthereumTransactionError | NonceToHighError | Error => {
  if ("code" in e && "action" in e && "message" in e && "reason" in e && "data" in e && e.reason !== undefined && e.reason !== null) {
    return new EthereumTransactionError(e.reason);
  } else if ("code" in e && "error" in e && "code" in e.error && "message" in e.error) {
    if (e.error.code === -32000 || e.error.message.startsWith("Nonce too high")) {
      return new NonceToHighError(e.error.message);
    }
  } else if (`${e}`.includes("nonce has already been used")) {
    return new NonceAlreadyBeenUsedError(`${e}`);
  }
  return e;
};

export type LockInfo = {
  assetId: string;
  assetType: AssetType;
  source: string;
  destination: string;
  amount: string;
}