import { Signer, Wallet, verifyTypedData, TypedDataEncoder } from 'ethers';

export type TypedDataField = {
  name: string;
  type: string;
};

export const EIP721_DOMAIN = {
  name: 'FinP2P',
  version: '1',
  chainId: 1,
  verifyingContract: '0x0',
};

export const EIP721_FINID_TYPE = {
  FinId: [{
    name: 'idkey', type: 'string',
  }],
};

export const EIP721_TERM_TYPE = {
  Term: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
    { name: 'amount', type: 'string' },
  ],
};

export const EIP721_ISSUANCE_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  PrimarySale: [
    { name: 'nonce', type: 'string' },
    { name: 'buyer', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const EIP721_TRANSFER_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  SecondarySale: [
    { name: 'nonce', type: 'string' },
    { name: 'seller', type: 'FinId' },
    { name: 'buyer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export const EIP721_REDEEM_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  Redemption: [
    { name: 'nonce', type: 'string' },
    { name: 'owner', type: 'FinId' },
    { name: 'buyer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export interface EIP721Message {
}

export interface EIP721IssuanceMessage extends EIP721Message {
  nonce: string,
  buyer: { idkey: string },
  issuer: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP721TransferMessage extends EIP721Message {
  nonce: string,
  buyer: { idkey: string },
  seller: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export interface EIP721RedeemMessage extends EIP721Message {
  nonce: string,
  owner: { idkey: string },
  buyer: { idkey: string },
  asset: { assetId: string, assetType: string, amount: string },
  settlement: { assetId: string, assetType: string, amount: string }
}

export const eip712SignWithPrivateKey = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerPrivateKey: string) => {
  return eip712Sign(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const eip712Sign = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signer: Signer) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const eip712Hash = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const eip712Verify = <T extends EIP721Message>(chainId: number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: T, signerAddress: string, signature: string) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};