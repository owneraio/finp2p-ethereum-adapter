import { Signer, TypedDataEncoder, verifyTypedData, Wallet } from "ethers";


export const enum Leg {
  Asset = 1,
  Settlement = 2
}

export const enum PrimaryType {
  PrimarySale = 1,
  Buying = 2,
  Selling = 3,
  Redemption = 4,
  RequestForTransfer = 5,
  PrivateOffer = 6,
  Loan = 7
}

export type TypedDataField = {
  name: string;
  type: string;
};

export const DOMAIN = {
  name: "FinP2P",
  version: "1",
  chainId: 1,
  verifyingContract: "0x0"
};

export const FINID_TYPE = {
  FinId: [{
    name: "idkey", type: "string"
  }]
};

export const TERM_TYPE = {
  Term: [
    { name: "assetId", type: "string" },
    { name: "assetType", type: "string" },
    { name: "amount", type: "string" }
  ]
};

export const PRIMARY_SALE_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  PrimarySale: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "issuer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const BUYING_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Buying: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const SELLING_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Selling: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const REDEMPTION_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  Redemption: [
    { name: "nonce", type: "string" },
    { name: "seller", type: "FinId" },
    { name: "issuer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const REQUEST_FOR_TRANSFER_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  RequestForTransfer: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const PRIVATE_OFFER_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  PrivateOffer: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const LOAN_TERMS_TYPE = {
  Term: [
    { name: "openTime", type: "string" },
    { name: "closeTime", type: "string" },
    { name: "borrowedMoneyAmount", type: "string" },
    { name: "returnedMoneyAmount", type: "string" }
  ]
};

export const LOAN_TYPES = {
  ...FINID_TYPE,
  ...TERM_TYPE,
  ...LOAN_TERMS_TYPE,
  Loan: [
    { name: "nonce", type: "string" },
    { name: "borrower", type: "FinId" },
    { name: "lender", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" },
    { name: "loanTerms", type: "LoanTerms" }
  ]
};


export const SOURCE_TYPE = {
  Source: [
    { name: "accountType", type: "string" },
    { name: "finId", type: "string" },
  ]
};

export const DESTINATION_TYPE = {
  Destination: [
    { name: "accountType", type: "string" },
    { name: "finId", type: "string" },
  ]
};

export const ASSET_TYPE = {
  Asset: [
    { name: "assetId", type: "string" },
    { name: "assetType", type: "string" },
  ]
};


export const EXECUTION_CONTEXT_TYPE = {
  ExecutionContext: [
    { name: "executionPlanId", type: "string" },
    { name: "instructionSequenceNumber", type: "string" },
  ]
};

export const TRADE_DETAILS_TYPE = {
  TradeDetails: [
    { name: "executionContext", type: "ExecutionContext" },
  ]
};

export const TRANSACTION_DETAILS_TYPE = {
  TransactionDetails: [
    { name: "operationId", type: "string" },
    { name: "transactionId", type: "string" },
  ]
};


export const RECEIPT_PROOF_TYPES = {
  ...SOURCE_TYPE,
  ...DESTINATION_TYPE,
  ...ASSET_TYPE,
  ...EXECUTION_CONTEXT_TYPE,
  ...TRADE_DETAILS_TYPE,
  ...TRANSACTION_DETAILS_TYPE,
  Receipt: [
    { name: "id", type: "string" },
    { name: "operationType", type: "string" },
    { name: "source", type: "Source" },
    { name: "destination", type: "Destination" },
    { name: "asset", type: "Asset" },
    // { name: "quantity", type: "string" },
    { name: "tradeDetails", type: "TradeDetails" },
    { name: "transactionDetails", type: "TransactionDetails" },
  ]
}

export interface EIP712Message {
}

export const term = (assetId: string, assetType: string, amount: string): Term => {
  return { assetId, assetType, amount };
}

export interface Term {
  assetId: string,
  assetType: string,
  amount: string
}

export interface FinId {
  idkey: string
}

export const finId = (key: string): FinId => {
  return { idkey: key };
}

export interface LoanTerms {
  openTime: string
  closeTime: string
  borrowedMoneyAmount: string
  returnedMoneyAmount: string
}

export interface EIP712PrimarySaleMessage extends EIP712Message {
  nonce: string,
  buyer: FinId,
  issuer: FinId,
  asset: Term,
  settlement: Term
}

export interface EIP712BuyingMessage extends EIP712Message {
  nonce: string,
  buyer: FinId,
  seller: FinId,
  asset: Term,
  settlement: Term
}

export interface EIP712SellingMessage extends EIP712Message {
  nonce: string,
  buyer: FinId,
  seller: FinId,
  asset: Term,
  settlement: Term
}

export interface EIP712RedemptionMessage extends EIP712Message {
  nonce: string,
  seller: FinId,
  issuer: FinId,
  asset: Term,
  settlement: Term
}

export interface EIP712RequestForTransferMessage extends EIP712Message {
  nonce: string,
  buyer: FinId,
  seller: FinId,
  asset: Term,
}

export interface EIP712PrivateOfferMessage extends EIP712Message {
  nonce: string,
  buyer: FinId,
  seller: FinId,
  asset: Term,
  settlement: Term
}

export interface EIP712LoanMessage extends EIP712Message {
  nonce: string,
  borrower: FinId,
  lender: FinId,
  asset: Term,
  settlement: Term
  loanTerms: LoanTerms
}

export interface Source {
  accountType: string
  finId: string
}

export const source = (accountType: string, finId: string): Source => {
  return { accountType, finId };
}

export interface Destination {
  accountType: string
  finId: string
}

export const destination = (accountType: string, finId: string): Destination => {
  return { accountType, finId };
}

export interface Asset {
  assetId: string
  assetType: string
}

export const asset = (assetId: string, assetType: string): Asset => {
  return { assetId, assetType };
}

export interface ExecutionContext {
  executionPlanId: string
  instructionSequenceNumber: string
}

export const executionContext = (executionPlanId: string, instructionSequenceNumber: string): ExecutionContext => {
  return { executionPlanId, instructionSequenceNumber };
}

export interface TradeDetails {
  executionContext: ExecutionContext
}

export const tradeDetails = (executionContext: ExecutionContext): TradeDetails => {
  return { executionContext };
}

export interface TransactionDetails {
  operationId: string
  transactionId: string
}

export const transactionDetails = (operationId: string, transactionId: string): TransactionDetails => {
  return { operationId, transactionId };
}


export interface EIP712ReceiptMessage extends EIP712Message {
  id: string,
  operationType: string,
  source: Source,
  destination: Destination,
  asset: Asset,
  quantity: string,
  tradeDetails: TradeDetails,
  transactionDetails: TransactionDetails
}

export const newPrimarySaleMessage = (nonce: string, buyer: FinId, issuer: FinId, asset: Term, settlement: Term): EIP712PrimarySaleMessage => {
  return { nonce, buyer, issuer, asset, settlement };
};

export const newBuyingMessage = (nonce: string, buyer: FinId, seller: FinId, asset: Term, settlement: Term): EIP712BuyingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newSellingMessage = (nonce: string, buyer: FinId, seller: FinId,asset: Term, settlement: Term): EIP712SellingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newRedemptionMessage = (nonce: string, issuer: FinId, seller: FinId, asset: Term, settlement: Term): EIP712RedemptionMessage => {
  return { nonce, issuer, seller, asset, settlement };
};

export const newRequestForTransferMessage = (nonce: string, buyer: FinId, seller: FinId, asset: Term): EIP712RequestForTransferMessage => {
  return { nonce, buyer, seller, asset };
};

export const newPrivateOfferMessage = (nonce: string, buyer: FinId,  seller: FinId, asset: Term, settlement: Term): EIP712PrivateOfferMessage => {
  return { nonce, buyer, seller, asset, settlement }
};

export const newLoanMessage = (nonce: string, borrower: FinId, lender: FinId, asset: Term, settlement: Term, loanTerms: LoanTerms): EIP712LoanMessage => {
  return { nonce, borrower, lender, asset, settlement, loanTerms };
};

export const newReceiptMessage = (id: string, operationType: string, source: Source, destination: Destination, asset: Asset, quantity: string, tradeDetails: TradeDetails, transactionDetails: TransactionDetails): EIP712ReceiptMessage => {
  return { id, operationType, source, destination, asset, quantity, tradeDetails, transactionDetails };
}

export const signWithPrivateKey = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerPrivateKey: string) => {
  return sign(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const sign = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signer: Signer) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const hash = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const verify = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerAddress: string, signature: string) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};