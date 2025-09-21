import * as secp256k1 from "secp256k1";
import * as crypto from "crypto";
import createKeccakHash from "keccak";

export const enum LegType {
  Asset = 0,
  Settlement = 1,
}

export const enum PrimaryType {
  PrimarySale = 0,
  Buying = 1,
  Selling = 2,
  Redemption = 3,
  Transfer = 4,
  PrivateOffer = 5,
  Loan = 6,
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

export const sign = (privateKey: string, payload: Buffer): Buffer => {
  const privKey = Buffer.from(privateKey.replace("0x", ""), "hex");
  const sigObj = secp256k1.sign(payload, privKey);
  return Buffer.from(sigObj.signature);
};

