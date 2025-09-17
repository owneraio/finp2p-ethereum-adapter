import {
  AssetType, EIP712Domain,
  EIP712Template, EIP712TypeArray, EIP712TypeBool,
  EIP712TypeByte,
  EIP712TypedValue, EIP712TypeInteger, EIP712TypeObject, EIP712Types, EIP712TypeString,
  ExecutionContext, finIdDestination,
  ProofPolicy,
  Receipt, TradeDetails
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  FinP2PReceipt,
  ExecutionContext as ContractExecutionContext,
  AssetType as ContractAssetType,
  TradeDetails as ContractTradeDetails,
  ReceiptProof as ContractReceiptProof,
  EIP712Template as ContractEIP712Template,
  EIP712Domain as ContractEIP712Domain,
  EIP712Types as ContractEIP712Types,
  EIP712Message as ContractEIP712Message
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

export const eip712DomainToService = (domain: ContractEIP712Domain): EIP712Domain => {
  const { name, version, chainId, verifyingContract } = domain;
  return { name, version, chainId, verifyingContract } as EIP712Domain;
};

export const eip712TypesToService = (types: ContractEIP712Types): EIP712Types => {
  return {
    definitions: Object.entries(types).map(([name, fields]) => ({
      name,
      fields: fields.map(field => ({
        name: field.name,
        type: field.type
      }))
    }))
  } as EIP712Types;
};

export const eip712MessageToAPI = (message: ContractEIP712Message): {
  [name: string]: EIP712TypedValue;
} => {
  const convertValue = (value: any): EIP712TypedValue => {
    if (typeof value === "string") {
      return /^0x[0-9a-fA-F]+$/.test(value) ? (value as EIP712TypeByte) : (value as EIP712TypeString);
    }
    if (typeof value === "number") {
      return value as EIP712TypeInteger;
    }
    if (typeof value === "boolean") {
      return value as EIP712TypeBool;
    }
    if (Array.isArray(value)) {
      return value.map(convertValue) as EIP712TypeArray;
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value)
        .map(([key, val]) => [key, convertValue(val)])) as EIP712TypeObject;
    }
    throw new Error("Unsupported EIP712 message value type");
  };

  return Object.fromEntries(Object.entries(message)
    .map(([key, val]) => [key, convertValue(val)])) as EIP712TypeObject;
};

export const eip712TemplateToService = (template: ContractEIP712Template): EIP712Template => {
  const { primaryType, domain, types, message, hash } = template;
  return {
    primaryType,
    type: "EIP712",
    types: eip712TypesToService(types),
    message: eip712MessageToAPI(message),
    domain: eip712DomainToService(domain),
    hash
  } as EIP712Template;
};

export const proofToService = (proof: ContractReceiptProof | undefined): ProofPolicy | undefined => {
  if (!proof) {
    return undefined;
  }
  switch (proof.type) {
    case "no-proof":
      return {
        type: "no-proof"
      };
    case "signature-proof":
      const { template, signature } = proof;
      return {
        hashFunc: "keccak-256",
        type: "signature-proof",
        template: eip712TemplateToService(template),
        signature: signature
      };
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
    proof
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
    proof: proofToService(proof)
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
