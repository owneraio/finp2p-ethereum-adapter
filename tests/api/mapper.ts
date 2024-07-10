import { TypedDataField } from "ethers/src.ts/hash";
import { EIP721Message } from "../../finp2p-contracts/src/contracts/eip721";


export const eip712TypesToAPI = (types: Record<string, Array<TypedDataField>>): Components.Schemas.EIP712Types => {
  const definitions = Object.entries(types)
    .map(([key, value]) => {
      // value.map((field) => {
      //   field.name
      //   field.type
      // })
      return {
        name: key,
        fields: []
      } as Components.Schemas.EIP712TypeDefinition
  });

  return {
    definitions
  } as Components.Schemas.EIP712Types;
}

export const eip712MessageToAPI = (message: EIP721Message): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {

  return {

  } as {
    [name: string]: Components.Schemas.EIP712TypedValue;
  };
}
