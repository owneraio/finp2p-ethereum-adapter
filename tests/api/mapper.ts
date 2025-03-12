import { EIP712Message, EIP712Types, hash, signWithPrivateKey } from "../../finp2p-contracts/src/contracts/eip712";

export const eip712Signature = async (chainId: number, verifyingContract: string, primaryType: string, types: Record<string, Array<TypedDataField>>, message: EIP712Message, signerPrivateKey: string) => {
  const hashVal = hash(chainId, verifyingContract, types, message);
  const signature = await signWithPrivateKey(chainId, verifyingContract, types, message, signerPrivateKey);
  return {
    signature: signature.replace("0x", ""), template: {
      type: "EIP712", domain: {
        name: "FinP2P", version: "1", chainId, verifyingContract
      }, primaryType, types: eip712TypesToAPI(types), message: eip712MessageToAPI(message), hash: hashVal
    }, hashFunc: "keccak_256"
  } as Components.Schemas.Signature;
};


export const eip712TypesToAPI = (types: EIP712Types): Components.Schemas.EIP712Types => {
  return {
    definitions: Object.entries(types)
      .map(([name, fields]) => {
        return { name, fields };
      })
  } as Components.Schemas.EIP712Types;
};


const isPrimitive = (value: any): boolean => {
  return value !== Object(value);
};

export const eip712MessageToAPI = (message: EIP712Message): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {
  const result: Record<string, Components.Schemas.EIP712TypedValue> = {};
  Object.entries(message).forEach(([name, value]) => {
    if (isPrimitive(value)) {
      result[name] = value;
    } else if (typeof value === "object" && value !== null) {
      result[name] = { ...value } as Components.Schemas.EIP712TypeObject;
    }
  });
  return result;
};

