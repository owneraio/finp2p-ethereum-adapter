import {
  LegType, PrimaryType, EIP712AssetType, AssetType as SrvAssetType
} from "@owneraio/finp2p-adapter-models";
import { keccak256, toUtf8Bytes } from "ethers";

export const ERC20_STANDARD_ID = keccak256(toUtf8Bytes('ERC20_WITH_OPERATOR'));

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

//
// struct ExecutionContext {
//   string planId;
//   uint8 sequence;
// }
export interface ExecutionContext {
  planId: string;
  sequence: number;
}

export const executionContext = (planId: string, sequence: number): ExecutionContext => {
  return {
    planId,
    sequence
  };
}

export interface OperationParams {
  leg: LegType;
  eip712PrimaryType: PrimaryType;
  phase: Phase;
  operationId: string;
  releaseType: ReleaseType;
  exCtx: ExecutionContext;
}

export const operationParams = (
  leg: LegType,
  eip712PrimaryType: PrimaryType,
  phase: Phase = Phase.Initiate,
  operationId: string = "",
  releaseType: ReleaseType = ReleaseType.Release,
  exCtx: ExecutionContext = executionContext("", 0)): OperationParams => {
  return {
    leg,
    eip712PrimaryType,
    phase,
    operationId,
    releaseType,
    exCtx
  };
};


export class EthereumTransactionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceTooHighError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class NonceAlreadyBeenUsedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export class EthereumContractMethodSignatureError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
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
