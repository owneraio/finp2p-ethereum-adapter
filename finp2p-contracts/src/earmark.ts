import { signEIP712 } from "./utils";
import { Signer } from "ethers";

export const OPERATION_TYPE_ISSUE = 0;
export const OPERATION_TYPE_TRANSFER = 1;
export const OPERATION_TYPE_HOLD = 2;
export const OPERATION_TYPE_RELEASE = 3;
export const OPERATION_TYPE_REDEEM = 4;

export const ASSET_TYPE_FINP2P = 0;
export const ASSET_TYPE_FIAT = 1;
export const ASSET_TYPE_CRYPTOCURRENCY = 2;

export interface Earmark {
  operationType: number;
  assetId: string;
  assetType: number;
  amount: string;
  source: string;
  destination: string;
  proofSignerFinId: string;
}

export interface ReceiptSource {
  accountType: string;
  finId: string;
}

export interface ReceiptDestination {
  accountType: string;
  finId: string;
}

export enum ReceiptAssetType {
  FINP2P,
  FIAT,
  CRYPTOCURRENCY
}

export interface ReceiptAsset {
  assetType: ReceiptAssetType;
  assetId: string;
}

export interface ReceiptExecutionContext {
  executionPlanId: string;
  instructionSequenceNumber: number;
}

export interface ReceiptTradeDetails {
  executionContext: ReceiptExecutionContext;
}

export interface ReceiptTransactionDetails {
  operationId: string;
  transactionId: string;
}

export interface ReceiptProof {
  id: string;
  operation: number;
  source: ReceiptSource;
  destination: ReceiptDestination;
  asset: ReceiptAsset;
  tradeDetails: ReceiptTradeDetails;
  transactionDetails: ReceiptTransactionDetails;
  quantity: string;
  signature: string;

}



