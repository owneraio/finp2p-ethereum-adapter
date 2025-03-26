import {
  Asset,
  AssetType,
  ExecutionContext,
  FinP2PReceipt,
  ReceiptOperationType,
  ReceiptTradeDetails,
  ReceiptExecutionContext,
  ReceiptProof
} from "../../finp2p-contracts/src/contracts/model";
import {
  EIP712Domain,
  EIP712LoanTerms,
  EIP712Message,
  EIP712Template,
  EIP712Types,
  emptyLoanTerms
} from "../../finp2p-contracts/src/contracts/eip712";
import LedgerAssetInfo = Components.Schemas.LedgerAssetInfo;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import ContractDetails = Components.Schemas.ContractDetails;
import AssetCreateResponse = Components.Schemas.AssetCreateResponse;
import FinP2PEVMOperatorDetails = Components.Schemas.FinP2PEVMOperatorDetails;
import EIP712TypeString = Components.Schemas.EIP712TypeString;
import ProofPolicy = Components.Schemas.ProofPolicy;


export const assetFromAPI = (asset: Components.Schemas.Asset): Asset => {
  switch (asset.type) {
    case "fiat":
      return {
        assetId: asset.code, assetType: AssetType.Fiat
      };
    case "finp2p":
      return {
        assetId: asset.resourceId, assetType: AssetType.FinP2P
      };
    case "cryptocurrency":
      return {
        assetId: asset.code, assetType: AssetType.Cryptocurrency
      };
  }
};

export const executionContextFromAPI = (executionContext: Components.Schemas.ReceiptExecutionContext | undefined): ExecutionContext => {
  if (!executionContext) {
    return { planId: "", sequence: 0 };
  }
  const { executionPlanId: planId, instructionSequenceNumber: sequence } = executionContext;
  return { planId, sequence };
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

export const assetToAPI = (assetId: string, assetType: AssetType): Components.Schemas.Asset => {
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

export const receiptToAPI = (receipt: FinP2PReceipt): Components.Schemas.Receipt => {
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
    operationType: operationTypeToAPI(operationType),
    proof: proofToAPI(proof)
  };
};

export const operationTypeToAPI = (operationType: ReceiptOperationType): Components.Schemas.OperationType => {
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
};

export const tradeDetailsToAPI = (tradeDetails: ReceiptTradeDetails | undefined): Components.Schemas.ReceiptTradeDetails => {
  if (!tradeDetails) {
    return {};
  }
  const { executionContext } = tradeDetails;
  return { executionContext: executionContextToAPI(executionContext) };
};

export const executionContextToAPI = (executionContext: ReceiptExecutionContext): Components.Schemas.ReceiptExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = executionContext;
  return { executionPlanId, instructionSequenceNumber };
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

export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

