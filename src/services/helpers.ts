import {
  Asset,
  Destination,
  EIP712Template,
  EIP712TypeObject,
  EIP712TypeString,
  ExecutionContext,
  SignatureTemplate, Source
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  assetTypeFromString, emptyTerm,
  operationParams,
  Phase,
  ReleaseType,
  Term,
  EIP712LoanTerms, emptyLoanTerms, LegType, PrimaryType
} from "@owneraio/finp2p-contracts";
import { EIP712Params } from "./model";


export const detectLeg = (asset: Asset, template: SignatureTemplate): LegType => {
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

export const extractEIP712Params = (asset: Asset,
                                    source: Source | undefined,
                                    destination: Destination | undefined,
                                    operationId: string | undefined,
                                    template: SignatureTemplate,
                                    executionContext: ExecutionContext): EIP712Params => {

  if (template.type != "EIP712") {
    throw new Error(`Unsupported signature template type: ${template.type}`);
  }

  const leg = detectLeg(asset, template);
  const eip712PrimaryType = eip712PrimaryTypeFromTemplate(template);

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
    case "Transfer":
    case "RequestForTransfer": { // RequestForTransfer deprecated, use Transfer
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
      let releaseType: ReleaseType;
      if (destination && destination.finId) {
        releaseType = ReleaseType.Release;
      } else {
        releaseType = ReleaseType.Redeem;
      }
      return {
        buyerFinId: finIdFromAPI(template.message.issuer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, releaseType)
      };
    }
    case "Loan": {
      let phase: Phase = Phase.Initiate;
      if (executionContext && executionContext.sequence > 3) {
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
    case "PrivateOffer": {
      return {
        buyerFinId: finIdFromAPI(template.message.buyer as EIP712TypeObject),
        sellerFinId: finIdFromAPI(template.message.seller as EIP712TypeObject),
        asset: termFromAPI(template.message.asset as EIP712TypeObject),
        settlement: termFromAPI(template.message.settlement as EIP712TypeObject),
        loan: emptyLoanTerms(),
        params: operationParams(leg, eip712PrimaryType, Phase.Initiate, operationId, ReleaseType.Release)
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

export const termFromAPI = (term: EIP712TypeObject): Term => {
  return {
    assetId: term.assetId as EIP712TypeString,
    assetType: assetTypeFromString(term.assetType as EIP712TypeString),
    amount: term.amount as EIP712TypeString
  };
};

export const loanTermFromAPI = (loanTerms: EIP712TypeObject | undefined): EIP712LoanTerms => {
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

export const finIdFromAPI = (finId: EIP712TypeObject): string => {
  return finId.idkey as EIP712TypeString;
};

const compareAssets = (asset: Asset, eipAsset: EIP712TypeObject): boolean => {
  if (isIn(eipAsset.assetType as string, "fiat", "cryptocurrency") && isIn(eipAsset.assetId as string, "USD", "USDC") &&
    isIn(asset.assetType as string, "fiat", "cryptocurrency") && isIn(asset.assetId, "USD", "USDC")) {
    return true;
  }
  return (eipAsset.assetId === asset.assetId && eipAsset.assetType === asset.assetType);
};

const isIn = (str: string, ...args: string[]): boolean => args.includes(str);
