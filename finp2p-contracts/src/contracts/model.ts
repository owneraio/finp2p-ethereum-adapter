import {
  asset,
  EIP712ReceiptMessage,
  EIP712Template,
  executionContext,
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
    asset: asset(assetId, assetType),
    tradeDetails: tradeDetails(executionContext("", "")),
    transactionDetails: transactionDetails(operationId || "", id)
  };
};

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
