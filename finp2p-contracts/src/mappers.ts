import {
  Asset,
  ServiceAssetType as SrvAssetType,
  Destination,
  EIP712Term,
  Source
} from "./adapter-types";
import { AssetType, assetTypeToEIP712, Term } from "./model";


export const assetToService = (assetId: string, assetType: bigint): Asset => {
  return {
    assetId,
    assetType: assetTypeToService(assetType),
    ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: '', tokenId: '', standard: '' },
  };
};

export const assetTypeToService = (assetType: bigint): SrvAssetType => {
  switch (assetType) {
    case 0n:
      return "finp2p";
    case 1n:
      return "fiat";
    case 2n:
      return "cryptocurrency";
    default:
      throw new Error("Invalid asset type");
  }
};

export const finIdSource = (finId: string): Source => {
  return { finId };
};

export const finIdDestination = (finId: string): Destination => {
  return { finId };
}

export const assetTypeFromString = (assetType: string): AssetType => {
  switch (assetType) {
    case "finp2p":
      return AssetType.FinP2P;
    case "fiat":
      return AssetType.Fiat;
    case "cryptocurrency":
      return AssetType.Cryptocurrency;
    default:
      throw new Error("Invalid asset type");
  }
};


export const termToEIP712 = (term: Term): EIP712Term => {
  return {
    assetId: term.assetId,
    assetType: assetTypeToEIP712(term.assetType),
    amount: term.amount
  };
};

export const termFromEIP712 = (eip712Term: EIP712Term): Term => {
  return {
    assetId: eip712Term.assetId,
    assetType: assetTypeFromString(eip712Term.assetType),
    amount: eip712Term.amount
  };
}

// loanTerms and emptyLoanTerms are now in adapter-types.ts
export { loanTerms, emptyLoanTerms } from './adapter-types';
