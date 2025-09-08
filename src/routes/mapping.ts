import {
  Asset,
  Source,
  Destination,
  Signature,
  ExecutionContext,
  AssetCreationStatus,
  ReceiptOperation,
  Balance, Receipt, OperationStatus, EIP712Template, EIP712Domain, EIP712Message, EIP712Types, TradeDetails,
  TransactionDetails, ProofPolicy, PlanApprovalStatus
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

export const assetToAPI = (asset: Asset): Components.Schemas.Asset => {
  switch (asset.assetType) {
    case "fiat":
      return { type: "fiat", code: asset.assetId } as Components.Schemas.FiatAsset;
    case "cryptocurrency":
      return { type: "cryptocurrency", code: asset.assetId } as Components.Schemas.CryptocurrencyAsset;
    case "finp2p":
      return { type: "finp2p", resourceId: asset.assetId } as Components.Schemas.Finp2pAsset;
  }
};

export const sourceFromAPI = (source: Components.Schemas.Source): Source => {
  const { finId } = source;
  return { finId };
};

export const sourceOptToAPI = (source: Source | undefined): Components.Schemas.Source | undefined => {
  if (!source) {
    return undefined;
  }
  const { finId } = source;
  return { finId, account: { type: "finId", finId } };
};

export const destinationFromAPI = (destination: Components.Schemas.Destination): Destination => {
  const { finId } = destination;
  return { finId };
};

export const destinationOptFromAPI = (destination: Components.Schemas.Destination | undefined): Destination | undefined => {
  if (!destination) {
    return undefined;
  }
  const { finId } = destination;
  return { finId };
};

export const destinationOptToAPI = (destination: Destination | undefined): Components.Schemas.Destination | undefined => {
  if (!destination) {
    return undefined;
  }
  const { finId } = destination;
  return { finId, account: { type: "finId", finId } };
};
export const executionContextFromAPI = (ep: Components.Schemas.ExecutionContext): ExecutionContext => {
  const { executionPlanId, instructionSequenceNumber } = ep;
  return { planId: executionPlanId, sequence: instructionSequenceNumber };
};

export const signatureFromAPI = (sg: Components.Schemas.Signature): Signature => {
  const { template, signature } = sg;
  switch (template.type) {
    case "EIP712":
      return {
        signature,
        template: eip712TemplateFromAPI(template)
      };
    default:
      throw new Error("hashList signature template not supported");
  }

};

export const eip712TemplateFromAPI = (template: Components.Schemas.EIP712Template): EIP712Template => {
  const { domain, primaryType, message, types } = template;
  return {
    type: "EIP712",
    primaryType,
    domain: domain as EIP712Domain,
    message: message as EIP712Message,
    types: types as EIP712Types
  } as EIP712Template;
};


export const planApprovalStatusToAPI = (status: PlanApprovalStatus): Components.Schemas.ExecutionPlanApprovalOperation => {
  switch (status.type) {
    case "approved":
      return {
        isCompleted: true,
        approval: {
          status: "approved"
        }
      } as Components.Schemas.ExecutionPlanApprovalOperation;

    case "rejected":
      const { code, message } = status.error;
      return {
        isCompleted: true,
        approval: {
          status: "rejected",
          failure: {
            failureType: "validationFailure",
            code, message
          }
        }
      } as Components.Schemas.ExecutionPlanApprovalOperation;

    case "pending":
      const { correlationId } = status;
      return {
        isCompleted: false,
        cid: correlationId
      } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

};

export const assetStatusToAPI = (result: AssetCreationStatus): Components.Schemas.CreateAssetResponse => {
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
              }
            }
          }
        }
      } as Components.Schemas.CreateAssetResponse;

    case "failure":
      const { code, message } = result.error;
      return {
        isCompleted: true, error: { code, message }
      } as Components.Schemas.CreateAssetResponse;

    case "pending":
      const { correlationId: cid } = result;
      return {
        isCompleted: false, cid
      } as Components.Schemas.CreateAssetResponse;

    default:
      throw new Error("Unsupported asset creation status");
  }
};

export const receiptResultToAPI = (result: ReceiptOperation): Components.Schemas.ReceiptOperation => {
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
    case "success":
      const { receipt } = result;
      return {
        isCompleted: true, response: receiptToAPI(receipt)
      } as Components.Schemas.ReceiptOperation;
  }
};

export const operationStatusToAPI = (result: OperationStatus): Components.Schemas.OperationStatus => {
  return {} as Components.Schemas.OperationStatus;
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

export const executionContextOptToAPI = (ep: ExecutionContext | undefined): Components.Schemas.ExecutionContext | undefined => {
  if (!ep) {
    return undefined;
  }
  const { planId, sequence } = ep;
  return { executionPlanId: planId, instructionSequenceNumber: sequence };
};

export const tradeDetailsToAPI = (tradeDetails: TradeDetails): Components.Schemas.ReceiptTradeDetails => {
  const { executionContext } = tradeDetails;
  return {
    executionContext: executionContextOptToAPI(executionContext)
  };
};

export const transactionDetailsToAPI = (details: TransactionDetails): Components.Schemas.TransactionDetails => {
  const { transactionId, operationId } = details;
  return {
    transactionId,
    operationId
  } as Components.Schemas.TransactionDetails;
};

export const eip712TemplateToAPI = (template: EIP712Template): Components.Schemas.EIP712Template => {
  const { domain, primaryType, message, types } = template;
  return {
    type: "EIP712",
    domain: domain as Components.Schemas.EIP712Domain,
    primaryType,
    message: message as {
      [name: string]: Components.Schemas.EIP712TypedValue;
    },
    types: types as Components.Schemas.EIP712Types
  } as Components.Schemas.EIP712Template;
};

export const proofPolicyOptToAPI = (proof: ProofPolicy | undefined): Components.Schemas.ProofPolicy | undefined => {
  if (!proof) {
    return undefined;
  }
  switch (proof.type) {
    case "no-proof":
      return {
        type: "noProofPolicy"
      } as Components.Schemas.ProofPolicy;

    case "signature-proof":
      const { signature, template } = proof;
      return {
        type: "signatureProofPolicy",
        signature: {
          template: eip712TemplateToAPI(template),
          hashFunc: "keccak-256",
          signature: signature
        }
      } as Components.Schemas.ProofPolicy;
  }

};

export const receiptToAPI = (receipt: Receipt): Components.Schemas.Receipt => {
  const {
    id,
    asset,
    source,
    destination,
    quantity,
    operationType,
    tradeDetails,
    transactionDetails,
    proof,
    timestamp
  } = receipt;
  return {
    id,
    asset: assetToAPI(asset),
    source: sourceOptToAPI(source),
    destination: destinationOptToAPI(destination),
    quantity,
    operationType: operationType as Components.Schemas.OperationType,
    tradeDetails: tradeDetailsToAPI(tradeDetails),
    transactionDetails: transactionDetailsToAPI(transactionDetails),
    proof: proofPolicyOptToAPI(proof),
    timestamp
  } as Components.Schemas.Receipt;
};
