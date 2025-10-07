import {
  LegType, PrimaryType, EIP712AssetType, AssetType as SrvAssetType
} from "@owneraio/finp2p-nodejs-skeleton-adapter";


export interface Term {
  assetId: string,
  assetType: AssetType,
  amount: string
}

export const enum AssetType {
  FinP2P = 0,
  Fiat = 1,
  Cryptocurrency = 2
}

export const term = (assetId: string, assetType: AssetType, amount: string): Term => {
  return { assetId, assetType, amount };
};

export const emptyTerm = (): Term => {
  return term("", 0, "");
};

export const assetTypeToEIP712 = (assetType: AssetType): EIP712AssetType => {
  switch (assetType) {
    case AssetType.FinP2P:
      return "finp2p";
    case AssetType.Fiat:
      return "fiat";
    case AssetType.Cryptocurrency:
      return "cryptocurrency";
  }
};


export interface EIP712LoanTerms {
  openTime: string;
  closeTime: string;
  borrowedMoneyAmount: string;
  returnedMoneyAmount: string;
}


export const enum Phase {
  Initiate = 0,
  Close = 1
}

export const enum ReleaseType {
  Release = 0,
  Redeem = 1
}

export interface OperationParams {
  leg: LegType;
  eip712PrimaryType: PrimaryType;
  phase: Phase;
  operationId: string;
  releaseType: ReleaseType;
}

export const operationParams = (
  leg: LegType,
  eip712PrimaryType: PrimaryType,
  phase: Phase = Phase.Initiate,
  operationId: string = "",
  releaseType: ReleaseType = ReleaseType.Release): OperationParams => {
  return {
    leg,
    eip712PrimaryType,
    phase,
    operationId,
    releaseType
  };
};


export class EthereumTransactionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceToHighError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceAlreadyBeenUsedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export const enum HashType {
  HashList = 1,
  EIP712 = 2
}

export type LockInfo = {
  assetId: string;
  assetType: SrvAssetType;
  source: string;
  destination: string;
  amount: string;
}
