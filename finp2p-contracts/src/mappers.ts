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
  // 0.28: assetType is no longer part of the EIP712 hash. Emit only the fields
  // that participate in hashing so consumers (ethers signTypedData / tests /
  // verify-signature scripts) produce a digest that matches the on-chain hash.
  return {
    assetId: term.assetId,
    amount: term.amount
  };
};

export const termFromEIP712 = (eip712Term: EIP712Term): Term => {
  // 0.28 dropped `assetType` from the on-the-wire Term payload; default to FinP2P
  // so adapter parsing still works against new-format messages. Pre-0.28 messages
  // still carry assetType and take the explicit path.
  return {
    assetId: eip712Term.assetId,
    assetType: eip712Term.assetType ? assetTypeFromString(eip712Term.assetType) : AssetType.FinP2P,
    amount: eip712Term.amount
  };
}

// loanTerms and emptyLoanTerms are now in adapter-types.ts
export { loanTerms, emptyLoanTerms } from './adapter-types';
