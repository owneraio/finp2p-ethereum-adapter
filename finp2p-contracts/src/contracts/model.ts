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