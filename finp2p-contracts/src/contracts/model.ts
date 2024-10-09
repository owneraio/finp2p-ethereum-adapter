export type OperationStatus = PendingTransaction | SuccessfulTransaction | FailedTransaction;

export type PendingTransaction = {
  status: 'pending'
};

export type SuccessfulTransaction = {
  status: 'completed'
  receipt: FinP2PReceipt
};

export type FinP2PReceipt = {
  id: string
  assetId: string
  assetType: 'cryptocurrency' | 'fiat' | 'finp2p'
  amount: number
  source?: string
  destination?: string,
  timestamp: number,
  operationType: 'transfer' | 'redeem' | 'hold' | 'release' | 'issue'
};

export type FailedTransaction = {
  status: 'failed'
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

export const detectError = (e: any) : EthereumTransactionError | NonceToHighError | Error => {
  if ('code' in e && 'action' in e && 'message' in e && 'reason' in e && 'data' in e) {
    return new EthereumTransactionError(e.reason);
  } else if ('code' in e && 'error' in e && 'code' in e.error && 'message' in e.error) {
    if (e.error.code === -32000 || e.error.message.startsWith('Nonce too high')) {
      return new NonceToHighError(e.error.message);
    }
  } else if ('code' in e && 'error' in e && 'code' in e.error && 'message' in e.error) {
    if (e.error.code === -32000 || e.error.message.startsWith('nonce has already been used')) {
      return new NonceAlreadyBeenUsedError(e.error.message);
    }
  }
  return e;
};

