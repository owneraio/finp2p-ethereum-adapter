import { TypedDataField } from "ethers/src.ts/hash";
import { EIP721Message } from "../../finp2p-contracts/src/contracts/eip721";


export const eip712TypesToAPI = (types: Record<string, Array<TypedDataField>>): Components.Schemas.EIP712Types => {
  return {
    definitions: Object.entries(types)
      .map(([name, fields]) => { return { name, fields }})
  } as Components.Schemas.EIP712Types;
}


const isPrimitive = (value: any) : boolean => {
  return value !== Object(value);
}


// export const eip712NestedMessageToAPI = (value: Record<string, any>)/*:{ fields?: { [name: string]: Components.Schemas.EIP712TypedValue } }*/ => {
//   return {
//     fields: Object.entries(value).map(([key, value]) => {
//       return { key: value }
//     })
//   }
// }

export const eip712MessageToAPI = (message: EIP721Message): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {
  const result: Record<string, Components.Schemas.EIP712TypedValue> = {}
  Object.entries(message).forEach(([name, value]) => {
    if (isPrimitive(value)) {
      result[name] = value
    } else if (typeof value === 'object' && value !== null) {
      result[name] = {
        fields: value
      }
    }
  })
  return result;
}

