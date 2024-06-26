import * as secp256k1 from 'secp256k1';
import * as crypto from 'crypto';
import createKeccakHash from 'keccak';


export const stringToByte16 = (str: string): string => {
  return "0x" + Buffer.from(str).slice(0, 16).toString('hex').padEnd(32, '0');
}

export const enumAssetTypeIndexByName = (assetType: string): number => {
  if (assetType === "finp2p") {
    return 0;
  } else {
    return 1;
  }
};

export const privateKeyToFinId = (privateKey: string): string => {
  const privKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
  const pubKeyUInt8Array = secp256k1.publicKeyCreate(privKeyBuffer, true);
  return Buffer.from(pubKeyUInt8Array).toString('hex');
}

export const combineHashes = (hashes: Buffer[]): Buffer => {
  return createKeccakHash("keccak256")
    .update(Buffer.concat(hashes))
    .digest();
}

export const hashValues = (values: any[]): Buffer => {
  return createKeccakHash("keccak256")
    .update(Buffer.concat(values.map(Buffer.from)))
    .digest();
}

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
    `${quantity}`
  ]);
}

export const settlementHash = (assetType: string, assetId: string,
                               sourceAssetType: string, sourceAccountId: string,
                               destinationAssetType: string, destinationAccountId: string,
                               quantity: number, expiry: number): Buffer => {
  let values = [assetType, assetId, sourceAssetType, sourceAccountId, destinationAssetType, destinationAccountId, `${quantity}`];
  if (expiry > 0) {
    values.push(`${expiry}`);
  }
  return hashValues(values);
}

export const randomHash = (): Buffer => {
  return createKeccakHash("keccak256")
    .update(crypto.randomBytes(32))
    .digest()
}

export const generateNonce = (): Buffer => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
}

export const sign = (privateKey: string, payload: Buffer): Buffer => {
  const privKey = Buffer.from(privateKey.replace('0x', ''), 'hex');
  const sigObj = secp256k1.sign(payload, privKey);
  return Buffer.from(sigObj.signature);
}

