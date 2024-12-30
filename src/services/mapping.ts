import { FinP2PReceipt } from "../../finp2p-contracts/src/contracts/model";
import { HashType } from "../../finp2p-contracts/src/contracts/hash";
import Asset = Components.Schemas.Asset;
import Receipt = Components.Schemas.Receipt;
import LedgerAssetInfo = Components.Schemas.LedgerAssetInfo;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import ContractDetails = Components.Schemas.ContractDetails;
import AssetCreateResponse = Components.Schemas.AssetCreateResponse;
import FinP2PEVMOperatorDetails = Components.Schemas.FinP2PEVMOperatorDetails;
import SignatureTemplate = Components.Schemas.SignatureTemplate;
import EIP712TypeObject = Components.Schemas.EIP712TypeObject;
import EIP712TypeString = Components.Schemas.EIP712TypeString;
import EIP712TypeInteger = Components.Schemas.EIP712TypeInteger;

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
    tradeDetails: {},
    operationType: receipt.operationType,
  };
};

export const assetCreationResult = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string) => {
  return {
    isCompleted: true,
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

export const notFoundErrorCode = 5;

export const assetNotFoundResult = (tokenId: string) => {
  return {
    isCompleted: true,
    error: {
      code: notFoundErrorCode,
      message: `Asset not found for token id ${tokenId}`,
    }
  } as CreateAssetResponse;
}


export const failedAssetCreation = (code: number, message: string) => {
  return {
    isCompleted: true,
    error: { code, message }
  } as Components.Schemas.CreateAssetResponse
}

export const failedTransaction = (code: number, message: string) => {
  return {
    isCompleted: true,
    error: { code, message }
  } as Components.Schemas.ReceiptOperation
}

export const issueParameterFromTemplate = (template: SignatureTemplate) : {
  hashType: HashType,
  buyerFinId: string,
  settlementAsset: string
  settlementAmount: number
} => {
  switch (template.type) {
    case 'hashList':
      return {
        hashType: HashType.HashList,
        buyerFinId: template.hashGroups[1].fields.find((field) => field.name === 'srcAccount')?.value || '',
        settlementAsset: template.hashGroups[1].fields.find((field) => field.name === 'assetId')?.value || '',
        settlementAmount: parseInt(template.hashGroups[1].fields.find((field) => field.name === 'amount')?.value || '')
      }

    case 'EIP712':
      const buyer = template.message.buyer as EIP712TypeObject;
      const settlement = template.message.settlement as EIP712TypeObject;
      return {
        hashType: HashType.EIP712,
        buyerFinId: buyer.idkey as EIP712TypeString,
        settlementAsset: settlement.assetId as EIP712TypeString,
        settlementAmount: settlement.amount as EIP712TypeInteger
      }
    default:
      throw new Error(`Unsupported signature template type: ${template}`);
  }
}

export const transferParameterFromTemplate = (template: SignatureTemplate): {
  hashType: HashType,
  settlementAsset: string
  settlementAmount: number
} => {
  switch (template.type) {
    case 'hashList':
      return {
        hashType: HashType.HashList,
        settlementAsset: template.hashGroups[1].fields.find((field) => field.name === 'assetId')?.value || '',
        settlementAmount: parseInt(template.hashGroups[1].fields.find((field) => field.name === 'amount')?.value || '')
      };

    case 'EIP712':
      const settlement = template.message.settlement as EIP712TypeObject;
      return {
        hashType: HashType.EIP712,
        settlementAsset: settlement.assetId as EIP712TypeString,
        settlementAmount: settlement.amount as EIP712TypeInteger
      }

    default:
      throw new Error(`Unsupported signature template type: ${template}`);
  }
}

export const redeemParameterFromTemplate = (template: SignatureTemplate): {
  hashType: HashType,
  buyerFinId: string
  settlementAsset: string
  settlementAmount: number
} => {
  switch (template.type) {
    case 'hashList':
      return {
        hashType: HashType.HashList,
        buyerFinId: template.hashGroups[1].fields.find((field) => field.name === 'srcAccount')?.value || '',
        settlementAsset: template.hashGroups[1].fields.find((field) => field.name === 'assetId')?.value || '',
        settlementAmount: parseInt(template.hashGroups[1].fields.find((field) => field.name === 'amount')?.value || '')
      };

    case 'EIP712':
      const buyer = template.message.buyer as EIP712TypeObject;
      const settlement = template.message.settlement as EIP712TypeObject;
      return {
        hashType: HashType.EIP712,
        buyerFinId: buyer.idkey as EIP712TypeString,
        settlementAsset: settlement.assetId as EIP712TypeString,
        settlementAmount: settlement.amount as EIP712TypeInteger
      }

    default:
      throw new Error(`Unsupported signature template type: ${template}`);
  }
}

export const holdParameterFromTemplate = (template: SignatureTemplate): {
  hashType: HashType,
  buyerFinId: string
  sellerFinId: string
  asset: string
  amount: number
} => {
  switch (template.type) {
    case 'hashList':
      return {
        hashType: HashType.HashList,
        buyerFinId: template.hashGroups[1].fields.find((field) => field.name === 'srcAccount')?.value || '',
        sellerFinId: template.hashGroups[1].fields.find((field) => field.name === 'dstAccount')?.value || '',
        asset: template.hashGroups[0].fields.find((field) => field.name === 'assetId')?.value || '',
        amount: parseInt(template.hashGroups[0].fields.find((field) => field.name === 'amount')?.value || '')
      };

    case 'EIP712':
      const asset = template.message.asset as EIP712TypeObject;
      const buyer = template.message.buyer as EIP712TypeObject;
      const seller = template.message.seller as EIP712TypeObject;
      return {
        hashType: HashType.EIP712,
        buyerFinId: buyer.idkey as EIP712TypeString,
        sellerFinId: seller.idkey as EIP712TypeString,
        asset: asset.assetId as EIP712TypeString,
        amount: asset.amount as EIP712TypeInteger
      }

    default:
      throw new Error(`Unsupported signature template type: ${template}`);
  }

}


export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}