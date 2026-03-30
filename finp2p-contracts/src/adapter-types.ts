/**
 * Locally defined types that mirror @owneraio/finp2p-adapter-models.
 * TypeScript structural typing ensures compatibility without coupling
 * to the adapter-models package.
 */

// Logger

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warning(...args: unknown[]): void;
  error(...args: unknown[]): void;
  alert(...args: unknown[]): void;
}

const LEVEL_ORDER = ['debug', 'info', 'warn', 'error'] as const;

export class ConsoleLogger implements Logger {
  private currentLevelIndex: number;
  constructor(level?: typeof LEVEL_ORDER[number]) {
    this.currentLevelIndex = LEVEL_ORDER.indexOf(level ?? 'info');
  }
  private shouldLog(level: number): boolean { return level >= this.currentLevelIndex; }
  debug(...args: unknown[]) { if (this.shouldLog(0)) console.debug(...args); }
  info(...args: unknown[]) { if (this.shouldLog(1)) console.info(...args); }
  warning(...args: unknown[]) { if (this.shouldLog(2)) console.warn(...args); }
  error(...args: unknown[]) { if (this.shouldLog(3)) console.error(...args); }
  alert(...args: unknown[]) { if (this.shouldLog(3)) console.error('[ALERT]', ...args); }
}

// EIP-712 enums

export const enum LegType {
  Asset = 0,
  Settlement = 1
}

export const enum PrimaryType {
  PrimarySale = 0,
  Buying = 1,
  Selling = 2,
  Redemption = 3,
  Transfer = 4,
  PrivateOffer = 5,
  Loan = 6
}

// Asset types

export type AssetType = 'finp2p' | 'fiat' | 'cryptocurrency';
export type EIP712AssetType = 'finp2p' | 'fiat' | 'cryptocurrency';

export type Asset = {
  assetId: string;
  assetType: AssetType;
};

// Accounts

export type FinIdAccount = {
  type: 'finId';
  finId: string;
};

export type CryptocurrencyWallet = {
  type: 'crypto';
  address: string;
};

export type IbanIdentifier = {
  type: 'iban';
  code: string;
};

export type SourceAccount = FinIdAccount;
export type DestinationAccount = FinIdAccount | CryptocurrencyWallet | IbanIdentifier;

export type Source = {
  finId: string;
  account: SourceAccount;
};

export type Destination = {
  finId: string;
  account: DestinationAccount;
};

// Execution context

export type ExecutionContext = {
  planId: string;
  sequence: number;
};

// EIP-712

export type EIP712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
};

export interface EIP712Term {
  assetId: string;
  assetType: string;
  amount: string;
}

// Receipt

export type OperationType = 'transfer' | 'redeem' | 'hold' | 'release' | 'issue';

export type TransactionDetails = {
  transactionId: string;
  operationId: string | undefined;
};

export type TradeDetails = {
  executionContext: ExecutionContext | undefined;
};

export type ProofPolicy = { type: 'no_proof' } | { type: 'signature'; template: any };

export type Receipt = {
  id: string;
  asset: Asset;
  source: Source | undefined;
  destination: Destination | undefined;
  quantity: string;
  transactionDetails: TransactionDetails;
  tradeDetails: TradeDetails;
  operationType: OperationType;
  proof: ProofPolicy | undefined;
  timestamp: number;
};

export type OperationResponseStrategy = 'polling' | 'callback';
export type OperationMetadata = {
  responseStrategy: OperationResponseStrategy;
};

export type SuccessReceiptStatus = {
  operation: 'receipt';
  type: 'success';
  receipt: Receipt;
};

export type FailedReceiptStatus = {
  operation: 'receipt';
  type: 'error';
  error: { code: number; message: string };
};

export type PendingReceiptStatus = {
  operation: 'receipt';
  type: 'pending';
  correlationId: string;
  metadata: OperationMetadata | undefined;
};

export type ReceiptOperation = PendingReceiptStatus | FailedReceiptStatus | SuccessReceiptStatus;

export const successfulReceiptOperation = (receipt: Receipt): ReceiptOperation => ({
  operation: 'receipt', type: 'success', receipt,
});

export const failedReceiptOperation = (code: number, message: string): ReceiptOperation => ({
  operation: 'receipt', type: 'error', error: { code, message },
});

export const pendingReceiptOperation = (correlationId: string, metadata: OperationMetadata | undefined): ReceiptOperation => ({
  operation: 'receipt', type: 'pending', correlationId, metadata,
});

// EIP-712 type definitions

type EIP712TypeField = { name: string; type: string };
export type EIP712Types = Record<string, EIP712TypeField[]>;
export interface EIP712Message {}

export const DOMAIN_TYPE: EIP712Types = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
};

export const FINID_TYPE: EIP712Types = {
  FinId: [{ name: 'idkey', type: 'string' }],
};

export const TERM_TYPE: EIP712Types = {
  Term: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
    { name: 'amount', type: 'string' },
  ],
};

export const PRIMARY_SALE_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  PrimarySale: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const BUYING_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  Buying: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const SELLING_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  Selling: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const REDEMPTION_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  Redemption: [
    { name: 'nonce', type: 'string' },
    { name: 'seller', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const TRANSFER_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  Transfer: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
  ],
};

export const PRIVATE_OFFER_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE,
  PrivateOffer: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'seller', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const LOAN_TERMS_TYPE: EIP712Types = {
  LoanTerms: [
    { name: 'openTime', type: 'string' },
    { name: 'closeTime', type: 'string' },
    { name: 'borrowedMoneyAmount', type: 'string' },
    { name: 'returnedMoneyAmount', type: 'string' },
  ],
};

export const LOAN_TYPES: EIP712Types = {
  ...FINID_TYPE, ...TERM_TYPE, ...LOAN_TERMS_TYPE,
  Loan: [
    { name: 'nonce', type: 'string' },
    { name: 'borrower', type: 'FinId' },
    { name: 'lender', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
    { name: 'loanTerms', type: 'LoanTerms' },
  ],
};

export const SOURCE_TYPE: EIP712Types = {
  Source: [
    { name: 'accountType', type: 'string' },
    { name: 'finId', type: 'string' },
  ],
};

export const DESTINATION_TYPE: EIP712Types = {
  Destination: [
    { name: 'accountType', type: 'string' },
    { name: 'finId', type: 'string' },
  ],
};

export const ASSET_TYPE: EIP712Types = {
  Asset: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
  ],
};

export const EXECUTION_CONTEXT_TYPE: EIP712Types = {
  ExecutionContext: [
    { name: 'executionPlanId', type: 'string' },
    { name: 'instructionSequenceNumber', type: 'string' },
  ],
};

export const TRADE_DETAILS_TYPE: EIP712Types = {
  TradeDetails: [
    { name: 'executionContext', type: 'ExecutionContext' },
  ],
};

export const TRANSACTION_DETAILS_TYPE: EIP712Types = {
  TransactionDetails: [
    { name: 'operationId', type: 'string' },
    { name: 'transactionId', type: 'string' },
  ],
};

export const RECEIPT_PROOF_TYPES: EIP712Types = {
  ...SOURCE_TYPE, ...DESTINATION_TYPE, ...TRANSACTION_DETAILS_TYPE,
  ...ASSET_TYPE, ...EXECUTION_CONTEXT_TYPE, ...TRADE_DETAILS_TYPE,
  Receipt: [
    { name: 'id', type: 'string' },
    { name: 'operationType', type: 'string' },
    { name: 'source', type: 'Source' },
    { name: 'destination', type: 'Destination' },
    { name: 'asset', type: 'Asset' },
    { name: 'tradeDetails', type: 'TradeDetails' },
    { name: 'transactionDetails', type: 'TransactionDetails' },
    { name: 'quantity', type: 'string' },
  ],
};

// EIP-712 message builders

export type EIP712FinId = { idkey: string };
export type EIP712Source = { accountType: string; finId: string };
export type EIP712Destination = { accountType: string; finId: string };
export type EIP712Asset = { assetId: string; assetType: string };
export type EIP712ExecutionContext = { executionPlanId: string; instructionSequenceNumber: string };
export type EIP712TradeDetails = { executionContext: EIP712ExecutionContext };
export type EIP712TransactionDetails = { operationId: string; transactionId: string };
export type EIP712LoanTerms = { openTime: string; closeTime: string; borrowedMoneyAmount: string; returnedMoneyAmount: string };

export interface EIP712ReceiptMessage extends EIP712Message {
  id: string;
  operationType: string;
  source: EIP712Source;
  destination: EIP712Destination;
  asset: EIP712Asset;
  quantity: string;
  tradeDetails: EIP712TradeDetails;
  transactionDetails: EIP712TransactionDetails;
}

export const eip712Term = (assetId: string, assetType: EIP712AssetType, amount: string): EIP712Term => ({ assetId, assetType, amount });
export const finId = (key: string): EIP712FinId => ({ idkey: key });
export const loanTerms = (openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string): EIP712LoanTerms => ({ openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount });
export const emptyLoanTerms = (): EIP712LoanTerms => loanTerms('', '', '', '');

export const eip712Source = (accountType: string, finId: string): EIP712Source => ({ accountType, finId });
export const eip712Destination = (accountType: string, finId: string): EIP712Destination => ({ accountType, finId });
export const eip712Asset = (assetId: string, assetType: string): EIP712Asset => ({ assetId, assetType });
export const eip712ExecutionContext = (executionPlanId: string, instructionSequenceNumber: string): EIP712ExecutionContext => ({ executionPlanId, instructionSequenceNumber });
export const eip712TradeDetails = (executionContext: EIP712ExecutionContext): EIP712TradeDetails => ({ executionContext });
export const eip712TransactionDetails = (operationId: string, transactionId: string): EIP712TransactionDetails => ({ operationId, transactionId });

export const newPrimarySaleMessage = (nonce: string, buyer: EIP712FinId, issuer: EIP712FinId, asset: EIP712Term, settlement: EIP712Term) => ({ nonce, buyer, issuer, asset, settlement });
export const newBuyingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term) => ({ nonce, buyer, seller, asset, settlement });
export const newSellingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term) => ({ nonce, buyer, seller, asset, settlement });
export const newRedemptionMessage = (nonce: string, issuer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term) => ({ nonce, issuer, seller, asset, settlement });
export const newTransferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term) => ({ nonce, buyer, seller, asset });
export const newPrivateOfferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term) => ({ nonce, buyer, seller, asset, settlement });
export const newLoanMessage = (nonce: string, borrower: EIP712FinId, lender: EIP712FinId, asset: EIP712Term, settlement: EIP712Term, loanTerms: EIP712LoanTerms) => ({ nonce, borrower, lender, asset, settlement, loanTerms });
export const newReceiptMessage = (id: string, operationType: string, source: EIP712Source, destination: EIP712Destination, asset: EIP712Asset, quantity: string, tradeDetails: EIP712TradeDetails, transactionDetails: EIP712TransactionDetails): EIP712ReceiptMessage => ({ id, operationType, source, destination, asset, quantity, tradeDetails, transactionDetails });

export class ValidationError extends Error {
  constructor(message: string) { super(message); }
}

export const newInvestmentMessage = (primaryType: PrimaryType, nonce: string, buyerFinId: string, sellerFinId: string, asset: EIP712Term, settlement: EIP712Term, loan?: EIP712LoanTerms): { message: EIP712Message; types: EIP712Types } => {
  let message: EIP712Message;
  let types: EIP712Types;
  switch (primaryType) {
    case PrimaryType.PrimarySale:
      types = PRIMARY_SALE_TYPES;
      message = newPrimarySaleMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Buying:
      types = BUYING_TYPES;
      message = newBuyingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Selling:
      types = SELLING_TYPES;
      message = newSellingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Redemption:
      types = REDEMPTION_TYPES;
      message = newRedemptionMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Transfer:
      types = TRANSFER_TYPES;
      message = newTransferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset);
      break;
    case PrimaryType.PrivateOffer:
      types = PRIVATE_OFFER_TYPES;
      message = newPrivateOfferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Loan:
      types = LOAN_TYPES;
      if (!loan) throw new ValidationError('Loan terms are required for loan intent');
      message = newLoanMessage(nonce, finId(sellerFinId), finId(buyerFinId), asset, settlement, loan);
      break;
    default:
      throw new ValidationError(`Unknown primary type: ${primaryType}`);
  }
  return { message, types };
};
