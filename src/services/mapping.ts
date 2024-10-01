import { FinP2PReceipt } from '../../finp2p-contracts/src/contracts/model';
import Asset = Components.Schemas.Asset;
import Receipt = Components.Schemas.Receipt;
import LedgerAssetInfo = Components.Schemas.LedgerAssetInfo;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import ContractDetails = Components.Schemas.ContractDetails;
import AssetCreateResponse = Components.Schemas.AssetCreateResponse;
import FinP2PEVMOperatorDetails = Components.Schemas.FinP2PEVMOperatorDetails;

export const extractAssetId = (asset: Components.Schemas.Asset): string => {
  switch (asset.type) {
    case 'fiat':
      return asset.code;
    case 'finp2p':
      return asset.resourceId;
    case 'cryptocurrency':
      return asset.code;
  }
};

const finIdSource = (finId?: string): Components.Schemas.Source | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId,
    account: {
      type: 'finId',
      finId: finId,
    },
  };
};
const finIdDestination = (finId?: string): Components.Schemas.Destination | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId,
    account: {
      type: 'finId',
      finId: finId,
    },
  };
};

export const assetToAPI = (assetId: string, assetType: 'cryptocurrency' | 'fiat' | 'finp2p'): Asset => {
  switch (assetType) {
    case 'fiat':
      return {
        type: 'fiat',
        code: assetId,
      };
    case 'finp2p':
      return {
        type: 'finp2p',
        resourceId: assetId,
      };
    case 'cryptocurrency':
      return {
        type: 'cryptocurrency',
        code: assetId,
      };
  }
};

export const receiptToAPI = (receipt: FinP2PReceipt): Receipt => {
  return {
    id: receipt.id,
    asset: assetToAPI(receipt.assetId, receipt.assetType),
    quantity: `${receipt.amount}`,
    source: finIdSource(receipt.source),
    destination: finIdDestination(receipt.destination),
    transactionDetails: {
      transactionId: receipt.id,
    },
    timestamp: receipt.timestamp,
    operationType: receipt.operationType,
  };
};

export const assetCreationResult = (cid: string, tokenId: string, tokenAddress: string, finp2pTokenAddress: string) => {
  return {
    isCompleted: true,
    cid: cid,
    response: {
      ledgerAssetInfo: {
        ledgerTokenId: {
          type: 'tokenId',
          tokenId: tokenId,
        } as LedgerTokenId,
        ledgerReference: {
          type: 'contractDetails',
          network: 'ethereum',
          address: tokenAddress,
          TokenStandard: 'TokenStandard_ERC20',
          additionalContractDetails: {
            FinP2POperatorContractAddress: finp2pTokenAddress,
            allowanceRequired: true
          } as FinP2PEVMOperatorDetails
        } as ContractDetails
      } as LedgerAssetInfo,
    } as AssetCreateResponse
  } as CreateAssetResponse;
}