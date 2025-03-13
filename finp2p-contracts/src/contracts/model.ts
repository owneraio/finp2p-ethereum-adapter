import { TypedDataDomain, TypedDataField } from "ethers";
import {
  asset,
  destination,
  EIP712ReceiptMessage,
  executionContext,
  source,
  tradeDetails,
  transactionDetails
} from "./eip712";

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

// similar to TypedDataDomain
export type EIP712Domain = {
  chainId: number
  verifyingContract: string
  name: string
  version: string
}

export type EIP712Template = {
  primaryType: string
  domain: TypedDataDomain,
  types: Record<string, Array<TypedDataField>>,
  message: Record<string, any>
  hash: string
}

export type TradeDetails = {
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

export type FinP2PReceipt = {
  id: string
  assetId: string
  assetType: string
  quantity: string
  source?: string
  destination?: string
  timestamp: number
  operationType: "transfer" | "redeem" | "hold" | "release" | "issue"
  operationId?: string
  tradeDetails?: TradeDetails
  proof?: ReceiptProof
};

export const receiptToEIP712Message = (receipt: FinP2PReceipt): EIP712ReceiptMessage => {
  return {
    id: receipt.id,
    operationType: receipt.operationType,
    source: source(receipt.source ? 'finp2p' : '', receipt.source || ''),
    destination: destination(receipt.destination ? 'finp2p' : '', receipt.destination || ''),
    // quantity,
    asset: asset(receipt.assetId, receipt.assetType),
    tradeDetails: tradeDetails(executionContext(
      receipt?.tradeDetails?.executionPlanId || '',
      `${receipt?.tradeDetails?.instructionSequenceNumber || ''} `)),
    transactionDetails: transactionDetails(receipt.operationId || '', receipt.id),
  }
}

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
