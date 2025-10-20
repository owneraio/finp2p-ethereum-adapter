import {
  Asset,
  AssetType as SrvAssetType,
  Destination,
  EIP712Term,
  Source
} from "@owneraio/finp2p-adapter-models";
import { AssetType, assetTypeToEIP712, EIP712LoanTerms, Term } from "./model";


export const assetToService = (assetId: string, assetType: bigint): Asset => {
  return { assetId, assetType: assetTypeToService(assetType) };
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
  return { finId, account: { type: "finId", finId } };
};

export const finIdDestination = (finId: string): Destination => {
  return { finId, account: { type: "finId", finId } };
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

export const emptyLoanTerms = (): EIP712LoanTerms => {
  return loanTerms("", "", "", "");
};

export const loanTerms = (openTime: string, closeTime: string, borrowedMoneyAmount: string, returnedMoneyAmount: string): EIP712LoanTerms => {
  return { openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount };
};
