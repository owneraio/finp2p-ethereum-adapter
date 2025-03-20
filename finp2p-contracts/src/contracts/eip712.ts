import { Signer, TypedDataEncoder, verifyTypedData, Wallet } from "ethers";



export const enum LegType {
  Asset = 0,
  Settlement = 1
}

export const enum PrimaryType {
  PrimarySale = 0,
  Buying = 1,
  Selling = 2,
  Redemption = 3,
  RequestForTransfer = 4,
  PrivateOffer = 5,
  Loan = 6
}

export type EIP712Domain = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

export const DOMAIN: EIP712Domain = {
  name: "FinP2P",
  version: "1",
  chainId: 1,
  verifyingContract: "0x0"
};

export const DOMAIN_TYPE = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" }
  ]
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
    { name: "asset", type: "Term" }
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
  LoanTerms: [
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
    { name: "finId", type: "string" }
  ]
};

export const DESTINATION_TYPE = {
  Destination: [
    { name: "accountType", type: "string" },
    { name: "finId", type: "string" }
  ]
};

export const ASSET_TYPE = {
  Asset: [
    { name: "assetId", type: "string" },
    { name: "assetType", type: "string" }
  ]
};


export const EXECUTION_CONTEXT_TYPE = {
  ExecutionContext: [
    { name: "executionPlanId", type: "string" },
    { name: "instructionSequenceNumber", type: "string" }
  ]
};

export const TRADE_DETAILS_TYPE = {
  TradeDetails: [
    { name: "executionContext", type: "ExecutionContext" }
  ]
};

export const TRANSACTION_DETAILS_TYPE = {
  TransactionDetails: [
    { name: "operationId", type: "string" },
    { name: "transactionId", type: "string" }
  ]
};


export const RECEIPT_PROOF_TYPES = {
  ...SOURCE_TYPE,
  ...DESTINATION_TYPE,
  ...TRANSACTION_DETAILS_TYPE,
  ...ASSET_TYPE,
  ...EXECUTION_CONTEXT_TYPE,
  ...TRADE_DETAILS_TYPE,
  Receipt: [
    { name: "id", type: "string" },
    { name: "operationType", type: "string" },
    { name: "source", type: "Source" },
    { name: "destination", type: "Destination" },
    { name: "asset", type: "Asset" },
    { name: "tradeDetails", type: "TradeDetails" },
    { name: "transactionDetails", type: "TransactionDetails" },
    // { name: "quantity", type: "string" }
  ]
};

export type EIP712Template = {
  primaryType: string
  domain: EIP712Domain,
  types: EIP712Types,
  message: EIP712Message
  hash: string
}

export type EIP712Types = Record<string, Array<{ name: string; type: string }>>

export interface EIP712Message {
}

export type EIP712AssetType = "finp2p" | "fiat" | "cryptocurrency";
export const eip712Term = (assetId: string, assetType: EIP712AssetType, amount: string): EIP712Term => {
  return { assetId, assetType, amount };
}


export interface EIP712Term {
  assetId: string,
  assetType: string,
  amount: string
}

export interface EIP712FinId {
  idkey: string;
}

export const finId = (key: string): EIP712FinId => {
  return { idkey: key };
};

export const emptyLoanTerms = (): EIP712LoanTerms => {
  return loanTerms("", "", "", "");
};

export const loanTerms = (openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string): EIP712LoanTerms => {
  return { openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount };
};

export interface EIP712LoanTerms {
  openTime: string;
  closeTime: string;
  borrowedMoneyAmount: string;
  returnedMoneyAmount: string;
}

export interface EIP712PrimarySaleMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  issuer: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712BuyingMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712SellingMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712RedemptionMessage extends EIP712Message {
  nonce: string,
  seller: EIP712FinId,
  issuer: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712RequestForTransferMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
}

export interface EIP712PrivateOfferMessage extends EIP712Message {
  nonce: string,
  buyer: EIP712FinId,
  seller: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
}

export interface EIP712LoanMessage extends EIP712Message {
  nonce: string,
  borrower: EIP712FinId,
  lender: EIP712FinId,
  asset: EIP712Term,
  settlement: EIP712Term
  loanTerms: EIP712LoanTerms
}

export type EIP712AccountType = 'finId' | 'iban' | 'cryptoWallet';

export interface EIP712Source {
  accountType: EIP712AccountType | '';
  finId: string;
}

export const eip712Source = (accountType: EIP712AccountType, finId: string): EIP712Source => {
  return { accountType, finId };
};

export interface EIP712Destination {
  accountType: EIP712AccountType | '';
  finId: string;
}

export const eip712Destination = (accountType: EIP712AccountType, finId: string): EIP712Destination => {
  return { accountType, finId };
};

export interface EIP712Asset {
  assetId: string;
  assetType: EIP712AssetType;
}

export const eip712Asset = (assetId: string, assetType: EIP712AssetType): EIP712Asset => {
  return { assetId, assetType };
};

export interface EIP712ExecutionContext {
  executionPlanId: string;
  instructionSequenceNumber: string;
}

export const eip712ExecutionContext = (executionPlanId: string, instructionSequenceNumber: string): EIP712ExecutionContext => {
  return { executionPlanId, instructionSequenceNumber };
};

export interface EIP7127TradeDetails {
  executionContext: EIP712ExecutionContext;
}

export const eip712TradeDetails = (executionContext: EIP712ExecutionContext): EIP7127TradeDetails => {
  return { executionContext };
};

export interface EIP712TransactionDetails {
  operationId: string;
  transactionId: string;
}

export const eip712TransactionDetails = (operationId: string, transactionId: string): EIP712TransactionDetails => {
  return { operationId, transactionId };
};


export interface EIP712ReceiptMessage extends EIP712Message {
  id: string,
  operationType: string,
  source: EIP712Source,
  destination: EIP712Destination,
  asset: EIP712Asset,
  // quantity: string,
  tradeDetails: EIP7127TradeDetails,
  transactionDetails: EIP712TransactionDetails
}

export const newInvestmentMessage = (
  primaryType: PrimaryType,
  nonce: string,
  buyerFinId: string,
  sellerFinId: string,
  asset: EIP712Term,
  settlement: EIP712Term,
  loan: EIP712LoanTerms | undefined = undefined
): { message: EIP712Message, types: EIP712Types } => {
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
    case PrimaryType.RequestForTransfer:
      types = REQUEST_FOR_TRANSFER_TYPES;
      message = newRequestForTransferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset);
      break;
    case PrimaryType.PrivateOffer:
      types = PRIVATE_OFFER_TYPES;
      message = newPrivateOfferMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement);
      break;
    case PrimaryType.Loan:
      types = LOAN_TYPES;
      if (!loan) {
        throw new Error("Loan terms are required for loan intent");
      }
      message = newLoanMessage(nonce, finId(sellerFinId), finId(buyerFinId), asset, settlement, loan);
      break;
    default:
      throw new Error(`Unknown primary type: ${primaryType}`);
  }
  return { message, types };
};

export const newPrimarySaleMessage = (nonce: string, buyer: EIP712FinId, issuer: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712PrimarySaleMessage => {
  return { nonce, buyer, issuer, asset, settlement };
};

export const newBuyingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712BuyingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newSellingMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712SellingMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newRedemptionMessage = (nonce: string, issuer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712RedemptionMessage => {
  return { nonce, issuer, seller, asset, settlement };
};

export const newRequestForTransferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term): EIP712RequestForTransferMessage => {
  return { nonce, buyer, seller, asset };
};

export const newPrivateOfferMessage = (nonce: string, buyer: EIP712FinId, seller: EIP712FinId, asset: EIP712Term, settlement: EIP712Term): EIP712PrivateOfferMessage => {
  return { nonce, buyer, seller, asset, settlement };
};

export const newLoanMessage = (nonce: string, borrower: EIP712FinId, lender: EIP712FinId, asset: EIP712Term, settlement: EIP712Term, loanTerms: EIP712LoanTerms): EIP712LoanMessage => {
  return { nonce, borrower, lender, asset, settlement, loanTerms };
};

export const newReceiptMessage = (id: string, operationType: string, source: EIP712Source, destination: EIP712Destination, asset: EIP712Asset, quantity: string, tradeDetails: EIP7127TradeDetails, transactionDetails: EIP712TransactionDetails): EIP712ReceiptMessage => {
  return { id, operationType, source, destination, asset/*, quantity*/, tradeDetails, transactionDetails };
};

export const signWithPrivateKey = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: EIP712Types, message: T, signerPrivateKey: string) => {
  return sign(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const sign = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: EIP712Types, message: T, signer: Signer) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const hash = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: EIP712Types, message: T) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const verify = <T extends EIP712Message>(chainId: bigint | number, verifyingContract: string, types: EIP712Types, message: T, signerAddress: string, signature: string) => {
  const domain = { ...DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};