import * as crypto from "crypto";
import createKeccakHash from "keccak";
import { Signer, TypedDataEncoder, TypedDataField, verifyTypedData, Wallet } from "ethers";
import { finIdToAddress } from "../src";


export const EIP712_DOMAIN = {
  name: 'FinP2P',
  version: '1',
  chainId: 1,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// For some reason Hardhat test can't recognize typescript enums from dependencies,
// so duplicating them here as const enums
export  const enum LegType {
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

export const toFixedDecimals = (value: string, decimals: number): string => {
  const [integer, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  if (decimals === 0) {
    return integer;
  }
  return `${integer}.${paddedFraction}`;
};

export const combineHashes = (hashes: Buffer[]): Buffer => {
  return createKeccakHash("keccak256")
    .update(Buffer.concat(hashes))
    .digest();
};

export const hashValues = (values: any[]): Buffer => {
  return createKeccakHash("keccak256")
    .update(Buffer.concat(values.map(Buffer.from)))
    .digest();
};


export const buildIssuanceHash = (nonce: string, issuer: string, buyer: string, assetId: string, assetType: string, amount: string, settlementAsset: string, settlementAssetType: string, settlementAmount: string) => {
  return combineHashes([hashValues([Buffer.from(nonce, "hex"), "issue", assetType, assetId, "finId", issuer, "finId", buyer, amount]), hashValues([settlementAssetType, settlementAsset, "finId", buyer, "finId", issuer, settlementAmount])]);
};

export const buildTransferHash = (nonce: string, seller: string, buyer: string, assetId: string, assetType: string, amount: string, settlementAsset: string, settlementAssetType: string, settlementAmount: string) => {
  return combineHashes([hashValues([Buffer.from(nonce, "hex"), "transfer", assetType, assetId, "finId", seller, "finId", buyer, amount]), hashValues([settlementAssetType, settlementAsset, "finId", buyer, "finId", seller, settlementAmount])]);
};

export const generateNonce = (): Buffer => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

export const signEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signer: Signer) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, types, message);
};

export const signEIP712WithPrivateKey = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerPrivateKey: string) => {
  return signEIP712(chainId, verifyingContract, types, message, new Wallet(signerPrivateKey));
};

export const hashEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>) => {
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, types, message);
};

export const verifyEIP712 = (chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>, signerFinId: string, signature: string) => {
  const signerAddress = finIdToAddress(signerFinId);
  const domain = { ...EIP712_DOMAIN, chainId, verifyingContract };
  const address = verifyTypedData(domain, types, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};



