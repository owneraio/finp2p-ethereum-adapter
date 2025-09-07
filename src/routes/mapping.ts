
import Asset = Components.Schemas.Asset;
import Receipt = Components.Schemas.Receipt;
import LedgerAssetInfo = Components.Schemas.LedgerAssetInfo;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import ContractDetails = Components.Schemas.ContractDetails;
import AssetCreateResponse = Components.Schemas.AssetCreateResponse;
import FinP2PEVMOperatorDetails = Components.Schemas.FinP2PEVMOperatorDetails;
import EIP712TypeString = Components.Schemas.EIP712TypeString;
import ProofPolicy = Components.Schemas.ProofPolicy;
import ReceiptExecutionContext = Components.Schemas.ReceiptExecutionContext;
import ReceiptTradeDetails = Components.Schemas.ReceiptTradeDetails;
import { ExecutionContext, AssetCreationResult, SrvAsset, TransactionResult } from "../services/model";
import ReceiptOperation = Components.Schemas.ReceiptOperation;

export const assetFromAPI = (asset: Components.Schemas.Asset): SrvAsset => {
  switch (asset.type) {
    case "fiat":
      return {
        assetId: asset.code, assetType: "fiat"
      };
    case "finp2p":
      return {
        assetId: asset.resourceId, assetType: "finp2p"
      };
    case "cryptocurrency":
      return {
        assetId: asset.code, assetType: "cryptocurrency"
      };
  }
};

const finIdSource = (finId?: string): Components.Schemas.Source | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId, account: {
      type: "finId", finId: finId
    }
  };
};

const finIdDestination = (finId?: string): Components.Schemas.Destination | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId, account: {
      type: "finId", finId: finId
    }
  };
};

export const executionContextFromAPI = (ep: Components.Schemas.ExecutionContext): ExecutionContext  => {
  const { executionPlanId, instructionSequenceNumber } = ep;
  return { planId: executionPlanId, sequence: instructionSequenceNumber };
}



export const assetResultToResponse = (result: AssetCreationResult): CreateAssetResponse => {
  switch (result.type) {
    case "success":
      const { tokenId, tokenAddress, finp2pTokenAddress } = result;
      return {
        isCompleted: true, response: {
          ledgerAssetInfo: {
            ledgerTokenId: {
              type: "tokenId", tokenId: tokenId
            } as LedgerTokenId, ledgerReference: {
              type: "contractDetails",
              network: "ethereum",
              address: tokenAddress,
              TokenStandard: "TokenStandard_ERC20",
              additionalContractDetails: {
                FinP2POperatorContractAddress: finp2pTokenAddress, allowanceRequired: true
              } as FinP2PEVMOperatorDetails
            } as ContractDetails
          } as LedgerAssetInfo
        } as AssetCreateResponse
      } as CreateAssetResponse;

    case "failure":
      const { code, message } = result.error;
      return {
        isCompleted: true, error: { code, message }
      } as CreateAssetResponse;
  }
};

export const transactionToAPI = (result: TransactionResult): ReceiptOperation => {
  switch (result.type) {
    case "success":
      const { txHash } = result;
      return {
        isCompleted: false, cid: txHash
      } as Components.Schemas.ReceiptOperation;
    case "failure":
      const { code, message } = result.error;
      return {
        isCompleted: true, error: { code, message }
      } as Components.Schemas.ReceiptOperation;
  }
};


export const failedTransaction = (code: number, message: string) => {
  return {
    isCompleted: true, error: { code, message }
  } as Components.Schemas.ReceiptOperation;
};


export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

