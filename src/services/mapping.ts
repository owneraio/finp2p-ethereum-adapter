import {
  AssetType,
  ExecutionContext, finIdDestination,
  Receipt, TradeDetails,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  FinP2PReceipt,
  ExecutionContext as ContractExecutionContext,
  AssetType as ContractAssetType,
  TradeDetails as ContractTradeDetails,

} from "../../finp2p-contracts/src";


export const assetTypeToService = (assetType: ContractAssetType): AssetType => {
  switch (assetType) {
    case ContractAssetType.Fiat:
      return "fiat";
    case ContractAssetType.FinP2P:
      return "finp2p";
    case ContractAssetType.Cryptocurrency:
      return "cryptocurrency";
  }
};


export const receiptToService = (receipt: FinP2PReceipt): Receipt => {
  const {
    id,
    assetId,
    assetType,
    quantity,
    source,
    destination,
    timestamp,
    operationId,
    operationType,
    tradeDetails,
  } = receipt;
  return {
    id,
    asset: {
      assetId,
      assetType: assetTypeToService(assetType)
    },
    quantity,
    source: source ? { finId: source, account: { type: "finId", finId: source } } : undefined,
    destination: destination ? finIdDestination(destination) : undefined,
    transactionDetails: {
      transactionId: id, operationId
    },
    timestamp,
    tradeDetails: tradeDetailsToService(tradeDetails),
    operationType,
    proof: undefined
  };
};

export const tradeDetailsToService = (tradeDetails: ContractTradeDetails | undefined): TradeDetails => {
  if (!tradeDetails) {
    return { executionContext: undefined };
  }
  const { executionContext } = tradeDetails;
  return { executionContext: executionContextToService(executionContext) };
};

export const executionContextToService = (executionContext: ContractExecutionContext): ExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = executionContext;
  return { planId: executionPlanId, sequence: instructionSequenceNumber };
};
