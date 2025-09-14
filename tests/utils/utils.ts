import * as secp256k1 from "secp256k1";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import createKeccakHash from "keccak";

export const ASSET = 102;
export const ACCOUNT = 103;

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

export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

export const randomResourceId = (orgId: string, resourceType: number) => {
  return `${orgId}:${resourceType}:${uuidv4()}`;
};

export const randomPort = () => {
  return Math.floor(Math.random() * 10000) + 10000;
};

type HashFunction = string;
let HashFunction = {
  SHA3_256: "sha3-256", BLAKE2B: "blake2b", KECCAK_256: "keccak-256"
};

export const hashBufferValues = (values: Buffer[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  let hashFn: crypto.Hash;
  switch (hashFunc) {
    case HashFunction.SHA3_256:
      hashFn = crypto.createHash(HashFunction.SHA3_256);
      break;
    case HashFunction.KECCAK_256:
      // @ts-ignore
      hashFn = createKeccakHash("keccak256");
      break;
    default:
      throw Error("unsupported hash function : " + hashFunc);
  }

  values.forEach((v) => {
    // console.log('value', v);
    hashFn.update(v);
  });

  return hashFn.digest();
};

export const hashValues = (values: any[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  return hashBufferValues(values.map(Buffer.from), hashFunc);
};
