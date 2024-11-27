import * as secp256k1 from 'secp256k1';
import * as crypto from 'crypto';

export const stringToByte16 = (str: string): string => {
  return '0x' + Buffer.from(str).slice(0, 16).toString('hex').padEnd(32, '0');
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