import { ExecutionContext } from "../model";


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
  return { executionContext: executionContextToAPI(executionContext) };
};

export const executionContextToAPI = (executionContext: ExecutionContext): ReceiptExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = executionContext;
  return { executionPlanId, instructionSequenceNumber };
};
