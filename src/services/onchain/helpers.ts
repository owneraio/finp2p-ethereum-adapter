import {
  EIP712LoanMessage,
  EIP712PrimarySaleMessage,
  EIP712PrivateOfferMessage,
  EIP712SellingMessage,
  EIP712BuyingMessage,
  EIP712Template,
  EIP712TransferMessage,
  EIP712RedemptionMessage,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  PrimaryType,
  ValidationError,
  emptyTerm,
  EIP712Term, EIP712LoanTerms, Term, emptyLoanTerms, termFromEIP712,
} from "@owneraio/finp2p-ethereum-orchestrator";


/**
 * Skeleton 0.28.9 made `EIP712Term.assetType` optional, while finp2p-contracts
 * still types it as required on its own EIP712Term. Coerce to the required shape
 * (default to 'finp2p' for omitted assetType, matching the route layer's
 * assetFromAPI convention) before forwarding to `termFromEIP712`.
 */
const toContractTerm = (t: { assetId: string; assetType?: string; amount: string }): EIP712Term => ({
  assetId: t.assetId,
  assetType: t.assetType ?? 'finp2p',
  amount: t.amount,
});


export type TemplateBusinessDetails = {
  primaryType: PrimaryType;
  nonce: string;
  buyerFinId: string;
  sellerFinId: string;
  asset: Term;
  settlement: Term;
  loan: EIP712LoanTerms;
};

/**
 * Extract the business details of a signed EIP712 investment intent from its
 * template alone: primary type, nonce, buyer/seller finIds and the asset,
 * settlement and loan terms. Contains no leg/phase/release logic — usable both
 * per-instruction (extractBusinessDetails) and at plan-approval time, where
 * the plan itself encodes ordering and direction.
 */
export const businessDetailsFromTemplate = (template: EIP712Template): TemplateBusinessDetails => {
  const primaryType = eip712PrimaryTypeFromTemplate(template);
  switch (template.primaryType) {
    case "PrimarySale": {
      const {
        nonce,
        buyer: { idkey: buyerFinId },
        issuer: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712PrimarySaleMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan: emptyLoanTerms()
      };
    }
    case "Buying": {
      const {
        nonce,
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712BuyingMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan: emptyLoanTerms()
      };
    }
    case "Selling": {
      const {
        nonce,
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712SellingMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan: emptyLoanTerms()
      };
    }
    case "Transfer": {
      const {
        nonce,
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset
      } = template.message as EIP712TransferMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: emptyTerm(),
        loan: emptyLoanTerms()
      };
    }
    case "Redemption": {
      const {
        nonce,
        issuer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712RedemptionMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan: emptyLoanTerms()
      };
    }
    case "Loan": {
      const {
        nonce,
        lender: { idkey: buyerFinId },
        borrower: { idkey: sellerFinId },
        asset, settlement,
        loanTerms: loan
      } = template.message as EIP712LoanMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan
      };
    }
    case "PrivateOffer": {
      const {
        nonce,
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset, settlement
      } = template.message as EIP712PrivateOfferMessage;
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: termFromEIP712(toContractTerm(settlement)),
        loan: emptyLoanTerms()
      };
    }
    case "Move": {
      const {
        nonce,
        source: { idkey: sellerFinId },
        destination: { idkey: buyerFinId },
        asset
      } = template.message as unknown as {
        nonce: string;
        source: { idkey: string };
        destination: { idkey: string };
        asset: { assetId: string; amount: string; assetType?: string };
      };
      return {
        primaryType, nonce, buyerFinId, sellerFinId,
        asset: termFromEIP712(toContractTerm(asset)),
        settlement: emptyTerm(),
        loan: emptyLoanTerms()
      };
    }
    default:
      throw new ValidationError(`Unsupported signature template primary type: ${template.primaryType}`);
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
    case "Move":
      return PrimaryType.Move;
    default:
      throw new ValidationError(`Unsupported EIP712 primary type: ${template.primaryType}`);
  }
};
