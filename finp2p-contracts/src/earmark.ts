import { signEIP712 } from "./utils";
import { Signer } from "ethers";
import {
  eip712Asset,
  eip712Destination, eip712ExecutionContext,
  eip712Source,
  eip712TradeDetails, eip712TransactionDetails,
  newReceiptMessage, RECEIPT_PROOF_TYPES
} from "@owneraio/finp2p-adapter-models";
import { EIP712AccountType, EIP712AssetType } from "@owneraio/finp2p-adapter-models/dist/eip712";

export enum ReceiptOperationType {
  ISSUE = 0,
  TRANSFER = 1,
  HOLD = 2,
  RELEASE = 3,
  REDEEM = 4
}

export enum ReceiptAssetType {
  FINP2P = 0,
  FIAT = 1,
  CRYPTOCURRENCY = 2
}


export interface Earmark {
  operationType: ReceiptOperationType;
  assetId: string;
  assetType: ReceiptAssetType;
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

export const signReceiptProof = async (chainId: bigint | number, verifyingContract: string, proof: ReceiptProof, proofProviderWallet: Signer): Promise<string> => {
  const message = newReceiptMessage(
    proof.id,
    operationTypeToString(proof.operation),
    eip712Source(proof.source.accountType as EIP712AccountType, proof.source.finId),
    eip712Destination(proof.destination.accountType as EIP712AccountType, proof.destination.finId),
    eip712Asset(proof.asset.assetId, receiptAssetTypeToEIP712(proof.asset.assetType)),
    proof.quantity,
    eip712TradeDetails(
      eip712ExecutionContext(
        proof.tradeDetails.executionContext.executionPlanId,
        `${proof.tradeDetails.executionContext.instructionSequenceNumber}`
      )),
    eip712TransactionDetails(proof.transactionDetails.operationId, proof.transactionDetails.transactionId));

  return await signEIP712(chainId, verifyingContract, RECEIPT_PROOF_TYPES, message, proofProviderWallet);
};

const operationTypeToString = (operationType: ReceiptOperationType): string => {
  switch (operationType) {
    case ReceiptOperationType.ISSUE:
      return "issue";
    case ReceiptOperationType.TRANSFER:
      return "transfer";
    case ReceiptOperationType.HOLD:
      return "hold";
    case ReceiptOperationType.RELEASE:
      return "release";
    case ReceiptOperationType.REDEEM:
      return "redeem";
    default:
      throw new Error(`Unsupported operation type: ${operationType}`);
  }
}

const receiptAssetTypeToEIP712 = (assetType: ReceiptAssetType): EIP712AssetType => {
  switch (assetType) {
    case ReceiptAssetType.FINP2P:
      return "finp2p";
    case ReceiptAssetType.FIAT:
      return "fiat";
    case ReceiptAssetType.CRYPTOCURRENCY:
      return "cryptocurrency";
    default:
      throw new Error(`Unsupported asset type: ${assetType}`);
  }
};

