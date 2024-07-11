import { ethers, TypedDataEncoder } from "ethers";
import type { TypedDataField } from "ethers/src.ts/hash";

export const EIP721_DOMAIN = {
  name: "FinP2P",
  version: "1",
  chainId: 1,
  verifyingContract: "0x0"
};

export const EIP721_FINID_TYPE = {
  FinId: [{
    name: "key", type: "string"
  }]
};

export const EIP721_TERM_TYPE = {
  Term: [
    { name: "assetId", type: "string" },
    { name: "assetType", type: "string" },
    { name: "amount", type: "uint256" }
  ]
};

export const EIP721_ISSUANCE_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  PrimarySale: [
    { name: "nonce", type: "uint256" },
    { name: "buyer", type: "FinId" },
    { name: "issuer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP721_TRANSFER_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  SecondarySale: [
    { name: "nonce", type: "uint256" },
    { name: "seller", type: "FinId" },
    { name: "buyer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export const EIP721_REDEEM_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  Redemption: [
    { name: "nonce", type: "uint256" },
    { name: "owner", type: "FinId" },
    { name: "buyer", type: "FinId" },
    { name: "asset", type: "Term" },
    { name: "settlement", type: "Term" }
  ]
};

export interface EIP721Message {
}

export interface EIP721IssuanceMessage extends EIP721Message {
  nonce: string,
  buyer: { key: string },
  issuer: { key: string },
  asset: { assetId: string, assetType: string, amount: number },
  settlement: { assetId: string, assetType: string, amount: number }
}

export interface EIP721TransferMessage extends EIP721Message {
  nonce: string,
  buyer: { key: string },
  seller: { key: string },
  asset: { assetId: string, assetType: string, amount: number },
  settlement: { assetId: string, assetType: string, amount: number }
}

export interface EIP721RedeemMessage extends EIP721Message {
  nonce: string,
  owner: { key: string },
  buyer: { key: string },
  asset: { assetId: string, assetType: string, amount: number },
  settlement: { assetId: string, assetType: string, amount: number }
}

export const signMessage = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signer: ethers.Signer) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const hashMessage = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const verifyMessage = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerAddress: string, signature: string) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  const address = ethers.verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};