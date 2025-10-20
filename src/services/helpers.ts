import {
  Asset,
  Destination,
  EIP712LoanMessage,
  EIP712PrimarySaleMessage,
  EIP712PrivateOfferMessage,
  EIP712SellingMessage,
  EIP712Term,
  EIP712BuyingMessage,
  EIP712Template,
  EIP712TransferMessage,
  EIP712RedemptionMessage,
  ExecutionContext,
  LegType,
  PrimaryType,
  SignatureTemplate,
  Source
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  emptyTerm,
  operationParams,
  Phase,
  ReleaseType,
  emptyLoanTerms, termFromEIP712
} from "@owneraio/finp2p-contracts";
import { BusinessContract } from "./model";


export const detectLeg = (asset: Asset, template: SignatureTemplate): LegType => {
  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }
  const { message } = template;
  if ("asset" in message && compareAssets(asset, message.asset as EIP712Term)) {
    return LegType.Asset;
  } else if ("settlement" in message && compareAssets(asset, message.settlement as EIP712Term)) {
    return LegType.Settlement;
  } else {
    throw new Error(`Asset not found in EIP712 message`);
  }
};

export const extractBusinessDetails = (asset: Asset,
                                       source: Source | undefined,
                                       destination: Destination | undefined,
                                       operationId: string | undefined,
                                       template: SignatureTemplate,
                                       executionContext: ExecutionContext): BusinessContract => {

  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }

  const leg = detectLeg(asset, template);
  const primaryType = eip712PrimaryTypeFromTemplate(template);

  switch (template.primaryType) {
    case "PrimarySale": {
      const {
        buyer: { idkey: buyerFinId },
        issuer: { idkey: sellerFinId },
        asset,
        settlement
      } = template.message as EIP712PrimarySaleMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Buying": {
      const {
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset,
        settlement
      } = template.message as EIP712BuyingMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Selling": {
      const {
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset,
        settlement
      } = template.message as EIP712SellingMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Transfer": {
      const {
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset
      } = template.message as EIP712TransferMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: emptyTerm(),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    case "Redemption": {
      const {
        issuer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712RedemptionMessage;
      let releaseType: ReleaseType;
      if (destination && destination.finId) {
        releaseType = ReleaseType.Release;
      } else {
        releaseType = ReleaseType.Redeem;
      }
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, releaseType)
      };
    }
    case "Loan": {
      let phase: Phase = Phase.Initiate;
      if (executionContext && executionContext.sequence > 3) {
        phase = Phase.Close;
      }
      const {
        lender: { idkey: buyerFinId },
        borrower: { idkey: sellerFinId },
        asset,
        settlement,
        loanTerms: loan
      } = template.message as EIP712LoanMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement), loan,
        params: operationParams(leg, primaryType, phase, operationId, ReleaseType.Release)
      };
    }
    case "PrivateOffer": {
      const {
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset,
        settlement
      } = template.message as EIP712PrivateOfferMessage;
      return {
        buyerFinId, sellerFinId,
        asset: termFromEIP712(asset),
        settlement: termFromEIP712(settlement),
        loan: emptyLoanTerms(),
        params: operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release)
      };
    }
    default:
      throw new Error(`Unsupported signature template primary type: ${template.primaryType}`);
  }
};

export const eip712PrimaryTypeFromTemplate = (template: EIP712Template): PrimaryType => {
  switch (template.primaryType) {
    case "PrimarySale":
      return PrimaryType.PrimarySale;
    case "Buying":
      return PrimaryType.Buying;
    case "Selling":
      return PrimaryType.Selling;
    case "Redemption":
      return PrimaryType.Redemption;
    case "PrivateOffer":
      return PrimaryType.PrivateOffer;
    case "Loan":
      return PrimaryType.Loan;
    case "Transfer":
      return PrimaryType.Transfer;
    default:
      throw new Error(`Unsupported EIP712 primary type: ${template.primaryType}`);
  }
};

const compareAssets = (asset: Asset, eipAsset: EIP712Term): boolean => {
  if (isIn(eipAsset.assetType as string, "fiat", "cryptocurrency") && isIn(eipAsset.assetId as string, "USD", "USDC") &&
    isIn(asset.assetType as string, "fiat", "cryptocurrency") && isIn(asset.assetId, "USD", "USDC")) {
    return true;
  }
  return (eipAsset.assetId === asset.assetId && eipAsset.assetType === asset.assetType);
};

const isIn = (str: string, ...args: string[]): boolean => args.includes(str);
