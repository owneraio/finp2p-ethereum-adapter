import {
  AssetType,
  assetTypeFromString,
  emptyTerm,
  ExecutionContext,
  FinP2PReceipt,
  operationParams,
  OperationParams,
  Phase,
  ReceiptProof,
  ReleaseType,
  Term,
  TradeDetails
} from "../../finp2p-contracts/src/contracts/model";
import {
  EIP712Domain,
  EIP712LoanTerms,
  EIP712Message,
  EIP712Template,
  EIP712Types,
  emptyLoanTerms,
  LegType,
  PrimaryType
} from "../../finp2p-contracts/src/contracts/eip712";
import Asset = Components.Schemas.Asset;
import Receipt = Components.Schemas.Receipt;
import LedgerAssetInfo = Components.Schemas.LedgerAssetInfo;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import ContractDetails = Components.Schemas.ContractDetails;
import AssetCreateResponse = Components.Schemas.AssetCreateResponse;
import FinP2PEVMOperatorDetails = Components.Schemas.FinP2PEVMOperatorDetails;
import EIP712TypeObject = Components.Schemas.EIP712TypeObject;
import EIP712TypeString = Components.Schemas.EIP712TypeString;
import ProofPolicy = Components.Schemas.ProofPolicy;
import Source = Components.Schemas.Source;
import Destination = Components.Schemas.Destination;
import Signature = Components.Schemas.Signature;
import ReceiptExecutionContext = Components.Schemas.ReceiptExecutionContext;
import ReceiptTradeDetails = Components.Schemas.ReceiptTradeDetails;

export const assetFromAPI = (asset: Components.Schemas.Asset): {
  assetId: string, assetType: "fiat" | "finp2p" | "cryptocurrency",
} => {
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

export const assetToAPI = (assetId: string, assetType: AssetType): Asset => {
  switch (assetType) {
    case AssetType.Fiat:
      return {
        type: "fiat", code: assetId
      };
    case AssetType.FinP2P:
      return {
        type: "finp2p", resourceId: assetId
      };
    case AssetType.Cryptocurrency:
      return {
        type: "cryptocurrency", code: assetId
      };
    default:
      throw new Error(`Unsupported asset type: ${assetType}`);
  }
};

export const eip712DomainToAPI = (domain: EIP712Domain): Components.Schemas.EIP712Domain => {
  const { name, version, chainId, verifyingContract } = domain;
  return { name, version, chainId, verifyingContract } as Components.Schemas.EIP712Domain;
};

export const eip712TypesToAPI = (types: EIP712Types): Components.Schemas.EIP712Types => {
  return {
    definitions: Object.entries(types).map(([name, fields]) => ({
      name,
      fields: fields.map(field => ({
        name: field.name,
        type: field.type
      }))
    }))
  } as Components.Schemas.EIP712Types;
};

export const eip712MessageToAPI = (message: EIP712Message): {
  [name: string]: Components.Schemas.EIP712TypedValue;
} => {
  const convertValue = (value: any): Components.Schemas.EIP712TypedValue => {
    if (typeof value === "string") {
      return /^0x[0-9a-fA-F]+$/.test(value) ? (value as Components.Schemas.EIP712TypeByte) : (value as EIP712TypeString);
    }
    if (typeof value === "number") {
      return value as Components.Schemas.EIP712TypeInteger;
    }
    if (typeof value === "boolean") {
      return value as Components.Schemas.EIP712TypeBool;
    }
    if (Array.isArray(value)) {
      return value.map(convertValue) as Components.Schemas.EIP712TypeArray;
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value)
        .map(([key, val]) => [key, convertValue(val)])) as Components.Schemas.EIP712TypeObject;
    }
    throw new Error("Unsupported EIP712 message value type");
  };

  return Object.fromEntries(Object.entries(message)
    .map(([key, val]) => [key, convertValue(val)])) as Components.Schemas.EIP712TypeObject;
};

export const eip712TemplateToAPI = (template: EIP712Template): Components.Schemas.EIP712Template => {
  const { primaryType, domain, types, message, hash } = template;
  return {
    primaryType,
    type: "EIP712",
    types: eip712TypesToAPI(types),
    message: eip712MessageToAPI(message),
    domain: eip712DomainToAPI(domain),
    hash
  } as Components.Schemas.EIP712Template;
};

export const proofToAPI = (proof: ReceiptProof | undefined): ProofPolicy | undefined => {
  if (!proof) {
    return undefined;
  }
  switch (proof.type) {
    case "no-proof":
      return {
        type: "noProofPolicy"
      };
    case "signature-proof":
      return {
        type: "signatureProofPolicy",
        signature: {
          template: eip712TemplateToAPI(proof.template),
          hashFunc: "keccak_256",
          signature: proof.signature
        }
      };
  }
};

export const receiptToAPI = (receipt: FinP2PReceipt): Receipt => {
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
    proof
  } = receipt;
  return {
    id,
    asset: assetToAPI(assetId, assetType),
    quantity,
    source: finIdSource(source),
    destination: finIdDestination(destination),
    transactionDetails: {
      transactionId: id, operationId
    },
    timestamp,
    tradeDetails: tradeDetailsToAPI(tradeDetails),
    operationType,
    proof: proofToAPI(proof)
  };
};

export const tradeDetailsToAPI = (tradeDetails: TradeDetails | undefined): ReceiptTradeDetails => {
  if (!tradeDetails) {
    return {};
  }
  const { executionContext } = tradeDetails;
  return { executionContext: executionContextToAPI(executionContext) }
};

export const executionContextToAPI = (executionContext: ExecutionContext): ReceiptExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = executionContext;
  return { executionPlanId, instructionSequenceNumber }
};

export const assetCreationResult = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string) => {
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
};

export const failedAssetCreation = (code: number, message: string) => {
  return {
    isCompleted: true, error: { code, message }
  } as Components.Schemas.CreateAssetResponse;
};

export const failedTransaction = (code: number, message: string) => {
  return {
    isCompleted: true, error: { code, message }
  } as Components.Schemas.ReceiptOperation;
};

export const termFromAPI = (term: Components.Schemas.EIP712TypeObject): Term => {
  return {
    assetId: term.assetId as EIP712TypeString,
    assetType: assetTypeFromString(term.assetType as EIP712TypeString),
    amount: term.amount as EIP712TypeString
  };
};

export const loanTermFromAPI = (loanTerms: Components.Schemas.EIP712TypeObject | undefined): EIP712LoanTerms => {
  if (!loanTerms) {
    return emptyLoanTerms();
  }
  return {
    openTime: loanTerms.openTime as EIP712TypeString,
    closeTime: loanTerms.closeTime as EIP712TypeString,
    borrowedMoneyAmount: loanTerms.borrowedMoneyAmount as EIP712TypeString,
    returnedMoneyAmount: loanTerms.returnedMoneyAmount as EIP712TypeString
  } as EIP712LoanTerms;
};

export const finIdFromAPI = (finId: Components.Schemas.EIP712TypeObject): string => {
  return finId.idkey as EIP712TypeString;
};

const compareAssets = (reqAsset: Components.Schemas.Asset, eipAsset: EIP712TypeObject): boolean => {
  const { assetId, assetType } = assetFromAPI(reqAsset);
  if (eipAsset.assetType === 'cryptocurrency' && eipAsset.assetId === 'USDC' && assetId === 'USD' && assetType === 'fiat') {
    return true;
  }
  return (eipAsset.assetId === assetId && eipAsset.assetType === assetType);
};

export type RequestType = 'issue' | 'transfer' | 'redeem' | 'hold' | 'release' | 'rollback';

export type RequestParams = {
  type: RequestType
  source: Source;
  destination?: Destination;
  asset: Asset;
  quantity: string;
  operationId?: string
  signature: Signature
  executionContext?: ExecutionContext
}

export type EIP712Params = {
  buyerFinId: string,
  sellerFinId: string,
  asset: Term,
  settlement: Term,
  loan: EIP712LoanTerms,
  params: OperationParams
};


export const detectLeg = (request: RequestParams): LegType => {
  const { signature: { template }, asset } = request
  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }
  if (compareAssets(asset, template.message.asset as EIP712TypeObject)) {
    return LegType.Asset;
  } else if (compareAssets(asset, template.message.settlement as EIP712TypeObject)) {
    return LegType.Settlement;
  } else {
    throw new Error(`Asset not found in EIP712 message`);
  }
};

export const detectReleaseType = (request: RequestParams): ReleaseType => {
  const { type, destination } = request
  switch (type) {
    case "hold":
      return destination ? ReleaseType.Release : ReleaseType.Redeem;
    default:
      return ReleaseType.Release;
  }
}

export const extractEIP712Params = (request: RequestParams): EIP712Params => {
  const { signature: { template }, operationId, executionContext } = request
  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }

  const leg = detectLeg(request);
  const eip712PrimaryType = eip71212PrimaryTypeFromTemplate(template);
  // const releaseType = detectReleaseType(request);

  switch (template.primaryType) {
    case "PrimarySale": {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Buying":
    case "Selling": {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "RequestForTransfer": {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: emptyTerm(),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Redemption": {
      return {
        buyerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, ReleaseType.Redeem)
      };
    }
    case "Loan": {
      let phase: Phase = Phase.Initiate;
      if (executionContext && executionContext.instructionSequenceNumber > 3) {
        phase = Phase.Close;
      }
      return {
        sellerFinId: finIdFromAPI(template.message.borrower as EIP712TypeObject),
        buyerFinId: finIdFromAPI(template.message.lender as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: loanTermFromAPI(template.message.loanTerms as EIP712TypeObject),
        params: operationParams(leg, eip712PrimaryType, phase, operationId, ReleaseType.Release)
      };
    }
    default:
      throw new Error(`Unsupported signature template primary type: ${template.primaryType}`);
  }
};

export const eip71212PrimaryTypeFromTemplate = (template: Components.Schemas.EIP712Template): PrimaryType => {
  switch (template.primaryType) {
    case "PrimarySale":
      return PrimaryType.PrimarySale;
    case "Buying":
      return PrimaryType.Buying;
    case "Selling":
      return PrimaryType.Selling;
    case "Redemption":
      return PrimaryType.Redemption;
    case "RequestForTransfer":
      return PrimaryType.RequestForTransfer;
    case "PrivateOffer":
      return PrimaryType.PrivateOffer;
    case "Loan":
      return PrimaryType.Loan;
    default:
      throw new Error(`Unsupported EIP712 primary type: ${template.primaryType}`);
  }
};


export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}