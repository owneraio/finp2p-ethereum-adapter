import {
  Asset,
  Source,
  Destination,
  Signature,
  ExecutionContext,
  AssetCreationResult,
  ReceiptResult,
  Balance
} from "../services/model";

export const assetFromAPI = (asset: Components.Schemas.Asset): Asset => {
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

export const sourceFromAPI = (source: Components.Schemas.Source): Source => {
  const { finId } = source;
  return { finId };
};

export const destinationFromAPI = (destination: Components.Schemas.Destination): Destination => {
  const { finId } = destination;
  return { finId };
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

export const executionContextFromAPI = (ep: Components.Schemas.ExecutionContext): ExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = ep;
  return { planId: executionPlanId, sequence: instructionSequenceNumber };
};

export const signatureFromAPI = (sg: Components.Schemas.Signature): Signature => {
  const { template, signature } = sg;
  switch (template.type) {
    case "EIP712":
      break;
    case "hashList":
      break;
  }
  const { type, domain, primaryType, messageTypes } = template;
  return {
    signature,
    template: {
      type: type as Components.Schemas.EIP712TypeString,
      domain,
      primaryType,
      messageTypes
    }
  };
};


export const assetResultToAPI = (result: AssetCreationResult): Components.Schemas.CreateAssetResponse => {
  switch (result.type) {
    case "success":
      const { tokenId, tokenAddress, finp2pTokenAddress } = result;
      return {
        isCompleted: true, response: {
          ledgerAssetInfo: {
            ledgerTokenId: {
              type: "tokenId", tokenId: tokenId
            } as Components.Schemas.LedgerTokenId,
            ledgerReference: {
              type: "contractDetails",
              network: "ethereum",
              address: tokenAddress,
              TokenStandard: "TokenStandard_ERC20",
              additionalContractDetails: {
                FinP2POperatorContractAddress: finp2pTokenAddress, allowanceRequired: true
              } as Components.Schemas.FinP2PEVMOperatorDetails
            } as Components.Schemas.ContractDetails
          } as Components.Schemas.LedgerAssetInfo
        } as Components.Schemas.AssetCreateResponse
      } as Components.Schemas.CreateAssetResponse;

    case "failure":
      const { code, message } = result.error;
      return {
        isCompleted: true, error: { code, message }
      } as Components.Schemas.CreateAssetResponse;
  }
};

export const receiptResultToAPI = (result: ReceiptResult): Components.Schemas.ReceiptOperation => {
  switch (result.type) {
    case "pending":
      const { correlationId: cid } = result;
      return {
        isCompleted: false, cid
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


export const balanceToAPI = (
  asset: Components.Schemas.Asset,
  account: Components.Schemas.AssetBalanceAccount,
  balance: Balance
): Components.Schemas.AssetBalanceInfoResponse => {
  const { current, available, held } = balance;
  return {
    account, asset,
    balanceInfo: {
      asset,
      current,
      available,
      held
    }
  } as Components.Schemas.AssetBalanceInfoResponse;
};
