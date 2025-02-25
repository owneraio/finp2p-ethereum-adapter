import { EIP712Domain, EIP712Template, FinP2PReceipt, ReceiptProof } from "../../finp2p-contracts/src/contracts/model";
import { EIP712ReceiptMessage, Leg, PrimaryType, term, Term } from "../../finp2p-contracts/src/contracts/eip712";
import { TypedDataField } from "ethers";
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
import ProofPolicy = Components.Schemas.ProofPolicy;

export const assetFromAPI = (asset: Components.Schemas.Asset): {
  assetId: string,
  assetType: 'fiat' | 'finp2p' | 'cryptocurrency',
} => {
  switch (asset.type) {
    case 'fiat':
      return {
        assetId: asset.code,
        assetType: 'fiat',
      };
    case 'finp2p':
      return {
        assetId: asset.resourceId,
        assetType: 'finp2p',
      };
    case 'cryptocurrency':
      return {
        assetId: asset.code,
        assetType: 'cryptocurrency',
      };
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

export const eip712DomainToAPI = (domain: EIP712Domain): Components.Schemas.EIP712Domain => {
  const { name, version, chainId, verifyingContract } = domain;
  return { name, version, chainId, verifyingContract } as Components.Schemas.EIP712Domain;
}

export const eip712TypesToAPI = (types: Record<string, Array<TypedDataField>>): Components.Schemas.EIP712Types => {
  return {

  } as Components.Schemas.EIP712Types;
}

export const eip712MessageToAPI = (message: Record<string, any>): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {
  return {

  }
}

export const eip712TemplateToAPI = (template: EIP712Template): Components.Schemas.EIP712Template => {
  const { primaryType, domain, types, message } = template;
  return {
    primaryType,
    type: 'EIP712',
    types: eip712TypesToAPI(types),
    message: eip712MessageToAPI(message),
    domain: eip712DomainToAPI(domain)
  } as Components.Schemas.EIP712Template;
}

export const proofToAPI = (proof: ReceiptProof): ProofPolicy => {
  switch (proof.type) {
    case "no-proof":
      return {
        type: 'noProofPolicy'
      }
    case "signature-proof":
      return  {
        type: 'signatureProofPolicy',
        signature: {
          template: eip712TemplateToAPI(proof.template),
          hashFunc: 'keccak_256',
          signature: proof.signature,
        },
      }
  }
}

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
    proof: proofToAPI(receipt.proof)
  };
};

export const receiptToEIP712Message = (receipt: FinP2PReceipt): EIP712ReceiptMessage => {
  return {
    id: receipt.id,
    source: receipt.source || '',
    destination: receipt.destination || '',
    assetId: receipt.assetId,
    assetType: receipt.assetType,
    quantity: `${receipt.amount}`,
  }
}

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

export const termFromAPI = (term: Components.Schemas.EIP712TypeObject): Term => {
  return {
    assetId: term.assetId as EIP712TypeString,
    assetType: term.assetType as EIP712TypeString,
    amount: term.amount as EIP712TypeString,
  }
}

export const finIdFromAPI = (finId: Components.Schemas.EIP712TypeObject): string => {
  return finId.idkey as EIP712TypeString;
}


const compareAssets = (eipAsset: EIP712TypeObject, reqAsset: {
  assetId: string,
  assetType: 'fiat' | 'finp2p' | 'cryptocurrency',
}): boolean => {
  return (eipAsset.assetId === reqAsset.assetId && eipAsset.assetType === reqAsset.assetType);

}

export const detectLeg = (template: Components.Schemas.SignatureTemplate, reqAsset: {
  assetId: string,
  assetType: 'fiat' | 'finp2p' | 'cryptocurrency',
}) : Leg => {
  if (template.type != 'EIP712') {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }
  if (compareAssets(template.message.asset as EIP712TypeObject, reqAsset)) {
    return Leg.Asset
  } else if (compareAssets(template.message.settlement as EIP712TypeObject, reqAsset)) {
    return Leg.Settlement
  } else {
    throw new Error(`Asset not found in EIP712 message`);
  }
}

export const extractParameterEIP712 = (template: Components.Schemas.SignatureTemplate, reqAsset: {
  assetId: string,
  assetType: 'fiat' | 'finp2p' | 'cryptocurrency',
}): {
  buyerFinId: string,
  sellerFinId: string,
  asset: Term,
  settlement: Term,
  leg: Leg,
  eip712PrimaryType: PrimaryType,
} => {
  if (template.type != 'EIP712') {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }

  const leg = detectLeg(template, reqAsset);
  const eip712PrimaryType = eip71212PrimaryTypeFromTemplate(template);
  switch (template.primaryType) {
    case 'PrimarySale': {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        leg, eip712PrimaryType,
      }
    }
    case 'Buying':
    case 'Selling': {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        leg, eip712PrimaryType,
      }
    }
    case 'RequestForTransfer': {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: term('', '', ''),
        leg, eip712PrimaryType,
      }
    }
    case 'Redemption': {
      return {
        // buyerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        // sellerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        buyerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        leg, eip712PrimaryType,
      }
    }
    default:
      throw new Error(`Unsupported signature template primary type: ${template.primaryType}`);
  }
}

export const eip71212PrimaryTypeFromTemplate = (template: Components.Schemas.EIP712Template): PrimaryType => {
  switch (template.primaryType) {
    case 'PrimarySale':
      return PrimaryType.PrimarySale;
    case 'Buying':
      return PrimaryType.Buying;
    case 'Selling':
      return PrimaryType.Selling;
    case 'Redemption':
      return PrimaryType.Redemption;
    case 'RequestForTransfer':
      return PrimaryType.RequestForTransfer;
    case 'PrivateOffer':
      return PrimaryType.PrivateOffer;
    case 'Loan':
      return PrimaryType.Loan;
    default:
      throw new Error(`Unsupported EIP712 primary type: ${template.primaryType}`);
  }
}


export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}