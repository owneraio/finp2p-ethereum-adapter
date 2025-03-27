import process from "process";
import {
  InstructionExecutor,
  InstructionType,
  AssetType,
  emptyTerm
} from "../../finp2p-contracts/src/contracts/model";
import { finApiAssetFromAPI } from "../services/mapping";
import { Instruction, InvestorSignature } from "./model";
import { EIP712LoanTerms, emptyLoanTerms } from "../../finp2p-contracts/src/contracts/eip712";


export const instructionFromAPI = (planId: string, instruction: FinAPIComponents.Schemas.ExecutionInstruction): Instruction => {
  const { sequence, executionPlanOperation: op, organizations } = instruction;
  const exCtx = { planId, sequence };
  const instructionExecutor = organizations.includes(process.env.MY_ORGANIZATION || "") ?
    InstructionExecutor.THIS_CONTRACT :
    InstructionExecutor.OTHER_CONTRACT;
  const proofSigner = "";
  const instructionType = instructionTypeFromAPI(op);
  const { asset, source, destination, amount, signature: sig } = instructionParamsFromAPI(op);
  const { assetId, assetType } = finApiAssetFromAPI(asset);
  const signature = investorSignatureFromAPI(sig);
  return {
    executionContext: exCtx, instructionType, assetId, assetType, source, destination, amount, executor: instructionExecutor, proofSigner, signature
  };
};

const instructionTypeFromAPI = (op: FinAPIComponents.Schemas.ExecutionPlanOperation): InstructionType => {
  switch (op.type) {
    case "issue":
      return InstructionType.ISSUE;
    case "transfer":
      return InstructionType.TRANSFER;
    case "redemption":
      return InstructionType.REDEEM;
    case "hold":
      return InstructionType.HOLD;
    case "release":
      return InstructionType.RELEASE;
    case "revert-hold":
      return InstructionType.RELEASE;
    case "await":
      return InstructionType.AWAIT;
  }
};

const instructionParamsFromAPI = (op: FinAPIComponents.Schemas.ExecutionPlanOperation) => {
  switch (op.type) {
    case "issue": {
      const { asset, destination: { finId: destination }, amount, signature } = op;
      return { asset, source: "", destination, amount, signature };
    }
    case "transfer": {
      const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
      return { asset, source, destination, amount, signature };
    }
    case "redemption": {
      const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
      return { asset, source, destination, amount, signature };
    }
    case "hold": {
      const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
      return { asset, source, destination, amount, signature };
    }
    case "release": {
      const { asset, source: { finId: source }, destination: { finId: destination }, amount } = op;
      return { asset, source, destination, amount, signature: undefined };
    }
    case "revert-hold": {
      const { asset, destination: { finId: destination } } = op;
      return { asset, source: "", destination, amount: "", signature: undefined };
    }
    case "await": {
      // return  {}

    }
    default:
      throw new Error("Invalid operation type");
  }
};

const investorSignatureFromAPI = (apiSignature: FinAPIComponents.Schemas.Signature | undefined): InvestorSignature | undefined => {
  if (!apiSignature) return undefined;
  const { signature, template } = apiSignature;
  if (template.type !== "EIP712") {
    throw new Error("Invalid template type only EIP712 is supported");
  }

  const { domain: apiDomain, message } = template;
  const domain = eip712DomainFromTemplate(apiDomain);

  switch (template.primaryType) {
    case "PrimarySale":
      return {
        domain,
        nonce: template.message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
        buyer: finIdFromAPI(message.buyer as FinAPIComponents.Schemas.EIP712TypeObject),
        seller: finIdFromAPI(message.issuer as FinAPIComponents.Schemas.EIP712TypeObject),
        asset: termFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
        settlement: termFromAPI(message.settlement as FinAPIComponents.Schemas.EIP712TypeObject),
        loan: emptyLoanTerms(),
        signature
      };

    case "Buying":
    case "Selling":
      return {
        domain,
        nonce: template.message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
        buyer: finIdFromAPI(message.buyer as FinAPIComponents.Schemas.EIP712TypeObject),
        seller: finIdFromAPI(message.seller as FinAPIComponents.Schemas.EIP712TypeObject),
        asset: termFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
        settlement: termFromAPI(message.settlement as FinAPIComponents.Schemas.EIP712TypeObject),
        loan: emptyLoanTerms(),
        signature
      };

    case "RequestForTransfer": {
      return {
        domain,
        nonce: template.message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
        buyer: finIdFromAPI(message.buyer as FinAPIComponents.Schemas.EIP712TypeObject),
        seller: finIdFromAPI(message.seller as FinAPIComponents.Schemas.EIP712TypeObject),
        asset: termFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
        settlement: emptyTerm(),
        loan: emptyLoanTerms(),
        signature
      };
    }
    case "Redemption": {
      return {
        domain,
        nonce: template.message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
        buyer: finIdFromAPI(message.issuer as FinAPIComponents.Schemas.EIP712TypeObject),
        seller: finIdFromAPI(message.seller as FinAPIComponents.Schemas.EIP712TypeObject),
        asset: termFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
        settlement: termFromAPI(message.settlement as FinAPIComponents.Schemas.EIP712TypeObject),
        loan: emptyLoanTerms(),
        signature
      };
    }
    case "Loan": {
      return {
        domain,
        nonce: template.message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
        seller: finIdFromAPI(message.borrower as FinAPIComponents.Schemas.EIP712TypeObject),
        buyer: finIdFromAPI(message.lender as FinAPIComponents.Schemas.EIP712TypeObject),
        asset: termFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
        settlement: termFromAPI(message.settlement as FinAPIComponents.Schemas.EIP712TypeObject),
        loan: loanTermFromAPI(message.loanTerms as FinAPIComponents.Schemas.EIP712TypeObject),
        signature
      };
    }
    default:
      throw new Error(`Unsupported signature template primary type: ${template.primaryType}`);
  }


  return undefined;
};

const finIdFromAPI = (finId: FinAPIComponents.Schemas.EIP712TypeObject): string => {
  return finId.idkey as FinAPIComponents.Schemas.EIP712TypeString;
};

const eip712DomainFromTemplate = (domain: FinAPIComponents.Schemas.EIP712Domain): {
  chainId: number | bigint,
  verifyingContract: string
} => {
  if (!domain.chainId || !domain.verifyingContract) {
    throw new Error("Invalid EIP712 domain");
  }
  const { chainId, verifyingContract } = domain;
  return { chainId, verifyingContract };
};

const termFromAPI = (term: FinAPIComponents.Schemas.EIP712TypeObject): {
  assetId: string,
  assetType: AssetType,
  amount: string
} => {
  return {
    assetId: term.assetId as FinAPIComponents.Schemas.EIP712TypeString,
    assetType: assetTypeFromString(term.assetType as FinAPIComponents.Schemas.EIP712TypeString),
    amount: term.amount as FinAPIComponents.Schemas.EIP712TypeString
  };
};

const loanTermFromAPI = (loanTerms: Components.Schemas.EIP712TypeObject | undefined): EIP712LoanTerms => {
  if (!loanTerms) {
    return emptyLoanTerms();
  }
  return {
    openTime: loanTerms.openTime as FinAPIComponents.Schemas.EIP712TypeString,
    closeTime: loanTerms.closeTime as FinAPIComponents.Schemas.EIP712TypeString,
    borrowedMoneyAmount: loanTerms.borrowedMoneyAmount as FinAPIComponents.Schemas.EIP712TypeString,
    returnedMoneyAmount: loanTerms.returnedMoneyAmount as FinAPIComponents.Schemas.EIP712TypeString
  } as EIP712LoanTerms;
};

const assetTypeFromString = (assetType: string): AssetType => {
  switch (assetType) {
    case "finp2p":
      return AssetType.FinP2P;
    case "fiat":
      return AssetType.Fiat;
    case "cryptocurrency":
      return AssetType.Cryptocurrency;
    default:
      throw new Error("Invalid asset type");
  }
};