import { AssetType, DestinationAccount } from "@owneraio/finp2p-adapter-models";

export type DepositIntentStatus = "pending" | "fulfilled" | "expired";
export type ObservedDepositStatus = "detected" | "fulfilled";

export type CreateDepositIntentInput = {
  referenceId: string;
  destinationFinId: string;
  destinationAccount: DestinationAccount;
  assetId: string;
  assetType: AssetType;
  tokenContractAddress: string;
  tokenDecimals: number;
  expectedAmount: string;
  expectedAmountUnits: string;
  senderAddress?: string;
  details?: any;
  expiresAt: Date;
};

export type OmnibusDepositIntent = {
  referenceId: string;
  destinationFinId: string;
  assetId: string;
  assetType: AssetType;
  tokenContractAddress: string;
  tokenDecimals: number;
  expectedAmount: string;
  expectedAmountUnits: string;
  senderAddress?: string;
  details?: any;
  status: DepositIntentStatus;
  transactionHash?: string;
  logIndex?: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ObservedOmnibusDeposit = {
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  assetId: string;
  assetType: AssetType;
  tokenContractAddress: string;
  tokenDecimals: number;
  senderAddress: string;
  recipientAddress: string;
  amountUnits: string;
  status: ObservedDepositStatus;
  matchedReferenceId?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackedOmnibusAsset = {
  assetId: string;
  assetType: AssetType;
  tokenContractAddress: string;
  tokenDecimals: number;
};
