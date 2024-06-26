import * as secp256k1 from "secp256k1";
import * as crypto from "crypto";
import createKeccakHash from "keccak";
import { ethers, TypedDataEncoder } from "ethers";


export const stringToByte16 = (str: string): string => {
  return '0x' + Buffer.from(str).slice(0, 16).toString('hex').padEnd(32, '0');
};


export const combineHashes = (hashes: Buffer[]): Buffer => {
  return createKeccakHash('keccak256')
    .update(Buffer.concat(hashes))
    .digest();
};

export const hashValues = (values: any[]): Buffer => {
  return createKeccakHash('keccak256')
    .update(Buffer.concat(values.map(Buffer.from)))
    .digest();
};

export const assetHash = (nonce: Buffer, operation: string,
  assetType: string, assetId: string,
  sourceAssetType: string, sourceAccountId: string,
  destinationAssetType: string, destinationAccountId: string,
  quantity: number): Buffer => {
  return hashValues([
    nonce,
    operation,
    assetType,
    assetId,
    sourceAssetType,
    sourceAccountId,
    destinationAssetType,
    destinationAccountId,
    `${quantity}`,
  ]);
};

export const settlementHash = (assetType: string, assetId: string,
  sourceAssetType: string, sourceAccountId: string,
  destinationAssetType: string, destinationAccountId: string,
  quantity: number, expiry: number): Buffer => {
  let values = [assetType, assetId, sourceAssetType, sourceAccountId, destinationAssetType, destinationAccountId, `${quantity}`];
  if (expiry > 0) {
    values.push(`${expiry}`);
  }
  return hashValues(values);
};

export const randomHash = (): Buffer => {
  return createKeccakHash('keccak256')
    .update(crypto.randomBytes(32))
    .digest();
};

export const generateNonce = (): Buffer => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

export const sign = (privateKey: string, payload: Buffer): Buffer => {
  const privKey = Buffer.from(privateKey.replace('0x', ''), 'hex');
  const sigObj = secp256k1.sign(payload, privKey);
  return Buffer.from(sigObj.signature);
};

const EIP721_DOMAIN = {
  name: 'FinP2P',
  version: '1',
  chainId: 1,
  verifyingContract: '0x0',
};

const EIP721_FINID_TYPE = {
  FinId: [{
    name: 'key', type: 'string',
  }],
};

const EIP721_TERM_TYPE = {
  Term: [
    { name: 'assetId', type: 'string' },
    { name: 'assetType', type: 'string' },
    { name: 'amount', type: 'uint256' },
  ],
};

const EIP721_ISSUANCE_TYPES = {
  ...EIP721_FINID_TYPE,
  ...EIP721_TERM_TYPE,
  PrimarySale: [
    { name: 'nonce', type: 'bytes32' },
    { name: 'buyer', type: 'FinId' },
    { name: 'issuer', type: 'FinId' },
    { name: 'asset', type: 'Term' },
    { name: 'settlement', type: 'Term' },
  ],
};

export type EIP721IssuanceMessage = {
  nonce: string,
  buyer: { key: string },
  issuer: { key: string },
  asset: { assetId: string, assetType: string, amount: number },
  settlement: { assetId: string, assetType: string, amount: number }
};

export const signEIP721Issuance = async (chainId: number, verifyingContract: string, message: EIP721IssuanceMessage, signer: ethers.Signer) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return signer.signTypedData(domain, EIP721_ISSUANCE_TYPES, message);
};

export const hashEIP721Issuance = (chainId: number, verifyingContract: string, message: EIP721IssuanceMessage) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  return TypedDataEncoder.hash(domain, EIP721_ISSUANCE_TYPES, message);
};

export const verifyEIP721Issuance = (chainId: number, verifyingContract: string, message: EIP721IssuanceMessage, signerAddress: string, signature: string) => {
  const domain = { ...EIP721_DOMAIN, chainId, verifyingContract };
  const address = ethers.verifyTypedData(domain, EIP721_ISSUANCE_TYPES, message, signature);
  return address.toLowerCase() === signerAddress.toLowerCase();
};

export const termHash = (assetId: string, assetType: string, amount: number) => {
  const types = { ...EIP721_TERM_TYPE };
  return TypedDataEncoder.from(types).hash({ assetId, assetType, amount });
};

export const createCrypto = (): { private: Buffer, public: Buffer } => {
  // generate privKey
  let privKey;
  do {
    privKey = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(privKey));

  // get the public key in a compressed format
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
  return { private: privKey, public: Buffer.from(pubKey) };
};