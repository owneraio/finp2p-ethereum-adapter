
import {
  eip712Hash,
  EIP712Message,
  eip712SignWithPrivateKey,
  TypedDataField
} from "../../finp2p-contracts/src/contracts/eip712";

export const eip712Signature = async (
  chainId: number,
  verifyingContract: string,
  primaryType: string,
  types: Record<string, Array<TypedDataField>>,
  message: EIP712Message,
  signerPrivateKey: string
) => {
  const hash = eip712Hash(chainId, verifyingContract, types, message)
  const signature = await eip712SignWithPrivateKey(chainId, verifyingContract, types, message, signerPrivateKey);
  return {
    signature: signature.replace('0x', ''),
    template: {
      type: 'EIP712',
      domain: {
        name: 'FinP2P',
        version: '1',
        chainId,
        verifyingContract
      },
      primaryType,
      types: eip712TypesToAPI(types),
      message: eip712MessageToAPI(message),
      hash,
    }
  } as Components.Schemas.Signature
}


export const eip712TypesToAPI = (types: Record<string, Array<TypedDataField>>): Components.Schemas.EIP712Types => {
  return {
    definitions: Object.entries(types)
      .map(([name, fields]) => { return { name, fields }})
  } as Components.Schemas.EIP712Types;
}


const isPrimitive = (value: any) : boolean => {
  return value !== Object(value);
}

export const eip712MessageToAPI = (message: EIP712Message): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {
  const result: Record<string, Components.Schemas.EIP712TypedValue> = {}
  Object.entries(message).forEach(([name, value]) => {
    if (isPrimitive(value)) {
      result[name] = value
    } else if (typeof value === 'object' && value !== null) {
      result[name] = { ...value } as Components.Schemas.EIP712TypeObject
    }
  })
  return result;
}

