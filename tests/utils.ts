import * as secp256k1 from 'secp256k1';
import * as crypto from 'crypto';
import {v4 as uuidv4} from 'uuid';

export const ASSET = 102
export const ACCOUNT = 103

export const createCrypto = (): { private: Buffer, public: Buffer } => {
  // generate privKey
  let privKey;
  do {
    privKey = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(privKey))

  // get the public key in a compressed format
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
  return {private: privKey, public: Buffer.from(pubKey)};
};

export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
}

export const randomResourceId = (orgId: string, resourceType: number) => {
  return `${orgId}:${resourceType}:${uuidv4()}`
}


export interface AssetGroup {
  nonce: Buffer;
  operation: string;
  source?: Components.Schemas.Source;
  destination?: Components.Schemas.Destination;
  quantity: number;
  asset: Components.Schemas.Asset;
}

export interface SettlementGroup {
  asset: Components.Schemas.Asset;
  source?: Components.Schemas.Source;
  destination?: Components.Schemas.Destination;
  quantity: number;
  expiry: number;
}

export const transferSignature = (assetGroup: AssetGroup, settlementGroup: SettlementGroup, hashFunc: string, privateKey: Buffer): Components.Schemas.Signature => {
  const hashGroups: Components.Schemas.HashGroup[] = [];
  const hashes: Buffer[] = [];
  if (assetGroup !== undefined) {
    let assetFields: Components.Schemas.Field[] = [];
    assetFields.push({name: "nonce", type: "bytes", value: assetGroup.nonce.toString('hex')});
    assetFields.push({name: "operation", type: "string", value: assetGroup.operation});
    assetFields.push({name: "assetType", type: "string", value: assetGroup.asset.type});
    assetFields.push({name: "assetId", type: "string", value: extractIdFromAsset(assetGroup.asset)});
    if (assetGroup.source !== undefined) {
      assetFields.push({name: "srcAccountType", type: "string", value: assetGroup.source.account.type});
      assetFields.push({
        name: "srcAccount",
        type: "string",
        value: extractIdFromSource(assetGroup.source.account)
      });
    }
    if (assetGroup.destination !== undefined) {
      assetFields.push({name: "dstAccountType", type: "string", value: assetGroup.destination.account.type});
      assetFields.push({
        name: "dstAccount",
        type: "string",
        value: extractIdFromDestination(assetGroup.destination.account)
      });
    }
    assetFields.push({name: "amount", type: "string", value: '0x' + Number(assetGroup.quantity).toString(16)});
    let assetHash = hashFields(assetFields, hashFunc);
    hashGroups.push({
      hash: assetHash.toString('hex'),
      fields: assetFields
    });
    hashes.push(assetHash);
  }

  if (settlementGroup !== undefined) {
    let settlementFields: Components.Schemas.Field[] = [];
    settlementFields.push({name: "assetType", type: "string", value: settlementGroup.asset.type});
    settlementFields.push({name: "assetId", type: "string", value: extractIdFromAsset(settlementGroup.asset)});
    if (settlementGroup.source !== undefined) {
      settlementFields.push({name: "srcAccountType", type: "string", value: settlementGroup.source.account.type});
      settlementFields.push({
        name: "srcAccount",
        type: "string",
        value: extractIdFromSource(settlementGroup.source.account)
      });
    }
    if (settlementGroup.destination !== undefined) {
      settlementFields.push({
        name: "dstAccountType",
        type: "string",
        value: settlementGroup.destination.account.type
      });
      settlementFields.push({
        name: "dstAccount",
        type: "string",
        value: extractIdFromDestination(settlementGroup.destination.account)
      });
    }
    settlementFields.push({
      name: "amount",
      type: "string",
      value: '0x' + Number(settlementGroup.quantity).toString(16)
    });
    if (settlementGroup.expiry > 0) {
      settlementFields.push({
        name: "expiry",
        type: "string",
        value: '0x' + Number(settlementGroup.expiry).toString(16)
      });
    }

    let settlementHash = hashFields(settlementFields, hashFunc);
    hashGroups.push({
      hash: settlementHash.toString('hex'),
      fields: settlementFields
    })
    hashes.push(settlementHash);
  }

  const hash = hashBufferValues(hashes, hashFunc);
  return {
    signature: sign(privateKey, hash),
    template: {
      hash: hash.toString("hex"),
      hashGroups: hashGroups
    }
  };
}

export const hashFields = (fields: Components.Schemas.Field[], hashFunc: string): Buffer => {
  let values: any = []
  for (let f of fields) {
    switch (f.type) {
      case "bytes":
        values.push(Buffer.from(f.value, "hex"));
        break
      case "string":
        values.push(f.value);
        break
    }
  }

  return hashValues(values, hashFunc)
}

const extractIdFromAsset = (asset: Components.Schemas.Asset): string => {
  switch (asset.type) {
    case "finp2p":
      return asset.resourceId
    case "cryptocurrency":
    case "fiat":
      return asset.code
  }
}

const extractIdFromSource = (account: Components.Schemas.FinIdAccount): string => {
  switch (account.type) {
    case "finId":
      return account.finId
  }
}

const extractIdFromDestination = (account: Components.Schemas.FinIdAccount |
  Components.Schemas.CryptoWalletAccount |
  Components.Schemas.FiatAccount | undefined): string => {
  if (account === undefined) {
    return ""
  }
  switch (account?.type) {
    case "finId":
      return account.finId
    case "cryptoWallet":
      return account.address
    case "fiatAccount":
      return account.code
  }
}


type HashFunction = string;
let HashFunction = {
  SHA3_256: 'sha3-256',
  BLAKE2B: 'blake2b',
  KECCAK_256: 'keccak-256'
}


export const hashValues = (values: any[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  return hashBufferValues(values.map(Buffer.from), hashFunc);
};

export const hashBufferValues = (values: Buffer[], hashFunc: HashFunction = HashFunction.SHA3_256) => {
  let hashFn: crypto.Hash;
  switch (hashFunc) {
    case HashFunction.SHA3_256:
      hashFn = crypto.createHash(HashFunction.SHA3_256);
      break;
    // case HashFunction.BLAKE2B:
    //     hashFn = blake2.createHash(HashFunction.BLAKE2B, {digestLength: 32});
    //     break;
    // case HashFunction.KECCAK_256:
    //     hashFn = createKeccakHash("keccak256");
    //     break;
    default:
      throw Error('unsupported hash function : ' + hashFunc);
  }

  values.forEach((v) => {
    // console.log('value', v);
    hashFn.update(v);
  });

  return hashFn.digest();
};

export const sign = (privKey: Buffer, hash: Buffer) => {
  const sigObj = secp256k1.sign(hash, privKey);
  return sigObj.signature.toString('hex');
}

export const verify = (mes: Buffer, signature: Buffer, pubKey: Buffer) => {
  return secp256k1.verify(mes, signature, pubKey)
}