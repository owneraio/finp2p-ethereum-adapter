import { Signer, TypedDataEncoder, verifyTypedData, Wallet } from "ethers";

export const enum EIP712PrimaryType {
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

export const EIP712_DOMAIN = {
  name: "FinP2P",
  version: "1",
  chainId: 1,
  verifyingContract: "0x0"
};

export const EIP712_FINID_TYPE = {
  FinId: [{
    name: "idkey", type: "string"
  }]
};

export const EIP712_TERM_TYPE = {
  Term: [
    { name: "assetId", type: "string" },
    { name: "assetType", type: "string" },
    { name: "amount", type: "string" }
  ]
};

export const EIP712_PRIMARY_SALE_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  PrimarySale: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "issuer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_BUYING_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  Buying: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_SELLING_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  Selling: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_REDEMPTION_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  Redemption: [
    { name: "nonce", type: "string" },
    { name: "seller", type: "FinId" },
    { name: "issuer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_REQUEST_FOR_TRANSFER_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  RequestForTransfer: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_PRIVATE_OFFER_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  PrivateOffer: [
    { name: "nonce", type: "string" },
    { name: "buyer", type: "FinId" },
    { name: "seller", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP712_LOAN_TERMS_TYPE = {
  Term: [
    { name: "openTime", type: "string" },
    { name: "closeTime", type: "string" },
    { name: "borrowedMoneyAmount", type: "string" },
    { name: "returnedMoneyAmount", type: "string" }
  ]
};

export const EIP712_LOAN_TYPES = {
  ...EIP712_FINID_TYPE,
  ...EIP712_TERM_TYPE,
  ...EIP712_LOAN_TERMS_TYPE,
  Loan: [
    { name: "nonce", type: "string" },
    { name: "borrower", type: "FinId" },
    { name: "lender", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" },
    { name: "loanTerms", type: "LoanTerms" }
  ]
};

export interface EIP712Message {
}

export interface EIP712PrimarySaleMessage extends EIP712Message {
  nonce: string,
  buyer: { idkey: string },
  issuer: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP712BuyingMessage extends EIP712Message {
  nonce: string,
  buyer: { idkey: string },
  seller: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP712SellingMessage extends EIP712Message {
  nonce: string,
  buyer: { idkey: string },
  seller: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP712RedemptionMessage extends EIP712Message {
  nonce: string,
  seller: { idkey: string },
  issuer: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP712RequestForTransferMessage extends EIP712Message {
  nonce: string,
  buyer: { idkey: string },
  seller: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
}

export interface EIP712PrivateOfferMessage extends EIP712Message {
  nonce: string,
  buyer: { idkey: string },
  seller: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP712LoanMessage extends EIP712Message {
  nonce: string,
  borrower: { idkey: string },
  lender: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
  loanTerms: { openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string }
}

export const newEIP712PrimarySaleMessage = (nonce: string, buyer: string, issuer: string, assetId: string, assetType: string, amount: string,
                                            settlementAsset: string, settlementAssetType: string, settlementAmount: string): EIP712PrimarySaleMessage => {
  return {
    nonce,
    buyer: { idkey: buyer },
    issuer: { idkey: issuer },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    }
  };
};

export const newEIP712BuyingMessage = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string,
                                       settlementAsset: string, settlementAssetType: string, settlementAmount: string): EIP712BuyingMessage => {
  return {
    nonce,
    buyer: { idkey: buyer },
    seller: { idkey: seller },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    }
  };
};

export const newEIP712SellingMessage = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string,
                                        settlementAsset: string, settlementAssetType: string, settlementAmount: string): EIP712SellingMessage => {
  return {
    nonce,
    buyer: { idkey: buyer },
    seller: { idkey: seller },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    }
  };
};

export const newRedemptionMessage = (nonce: string, seller: string, issuer: string, assetId: string, assetType: string, amount: string,
                                     settlementAsset: string, settlementAssetType: string, settlementAmount: string): EIP712RedemptionMessage => {
  return {
    nonce,
    seller: { idkey: seller },
    issuer: { idkey: issuer },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    }
  };
};

export const newEIP712RequestForTransferMessage = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string): EIP712RequestForTransferMessage => {
  return {
    nonce,
    buyer: { idkey: buyer },
    seller: { idkey: seller },
    asset: {
      assetId,
      assetType,
      amount
    }
  };
};

export const newEIP712PrivateOfferMessage = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string,
                                             settlementAsset: string, settlementAssetType: string, settlementAmount: string): EIP712PrivateOfferMessage => {
  return {
    nonce,
    buyer: { idkey: buyer },
    seller: { idkey: seller },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    }
  };
};

export const newEIP712LoanMessage = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string,
                                     settlementAsset: string, settlementAssetType: string, settlementAmount: string,
                                     openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string): EIP712LoanMessage => {
  return {
    nonce,
    borrower: { idkey: buyer },
    lender: { idkey: seller },
    asset: {
      assetId,
      assetType,
      amount
    },
    settlement: {
      assetId: settlementAsset,
      assetType: settlementAssetType,
      amount: settlementAmount
    },
    loanTerms: {
      openTime,
      closeTime,
      borrowedMoneyAmount,
      returnedMoneyAmount
    }
  };
};

export const eip712SignWithPrivateKey = <T extends EIP712Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerPrivateKey: string) => {
  return eip712Sign(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const eip712Sign = <T extends EIP712Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signer: Signer) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const eip712Hash = <T extends EIP712Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const eip712Verify = <T extends EIP712Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerAddress: string, signature: string) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};