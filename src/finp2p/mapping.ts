import process from "process";
import {
  InstructionExecutor,
  InstructionType,
  emptyTerm, receiptOperationTypeFromEIP712, Term, assetTypeFromString
} from "../../finp2p-contracts/src/contracts/model";
import { finApiAssetFromAPI } from "../services/mapping";
import { Instruction, InstructionCompletionProof, InvestorSignature } from "./model";
import {
  EIP712AccountType,
  EIP712ReceiptAsset,
  EIP712ReceiptDestination,
  EIP712LoanTerms,
  EIP712ReceiptSource, EIP712ReceiptTradeDetails, EIP712ReceiptTransactionDetails,
  emptyLoanTerms, EIP712AssetType, EIP712ReceiptExecutionContext
} from "../../finp2p-contracts/src/contracts/eip712";


export const instructionFromAPI = (planId: string, instruction: FinAPIComponents.Schemas.ExecutionInstruction): Instruction => {
  const { sequence, executionPlanOperation: op, organizations } = instruction;
  const exCtx = { planId, sequence };
  if (!organizations || organizations.length === 0) {
    throw new Error("No organizations found");
  }
  const organizationId = organizations[0];
  const instructionExecutor = organizationId === process.env.MY_ORGANIZATION || "" ?
    InstructionExecutor.THIS_CONTRACT :
    InstructionExecutor.OTHER_CONTRACT;
  const proofSigner = "";
  const instructionType = instructionTypeFromAPI(op);
  const { asset, source, destination, amount, signature: sig } = instructionParamsFromAPI(op);
  const { assetId, assetType } = finApiAssetFromAPI(asset);
  const signature = investorSignatureFromAPI(sig);
  return {
    executionContext: exCtx,
    instructionType,
    assetId,
    assetType,
    source,
    destination,
    amount,
    executor: instructionExecutor,
    organizationId,
    proofSigner,
    signature
  };
};

export const instructionCompletionProofFromAPI = (apiSignature: FinAPIComponents.Schemas.Signature): InstructionCompletionProof => {
  const { signature, template } = apiSignature;
  if (template.type !== "EIP712") {
    throw new Error("Invalid template type only EIP712 is supported");
  }
  const { domain, message, primaryType } = template;
  if (primaryType !== "Receipt") {
    throw new Error("Unsupported signature template primary type");
  }
  return {
    domain: eip712DomainFromTemplate(domain),
    id: message.id as FinAPIComponents.Schemas.EIP712TypeString,
    operation: receiptOperationTypeFromEIP712(message.id as FinAPIComponents.Schemas.EIP712TypeString),
    source: receiptSourceFromAPI(message.source as FinAPIComponents.Schemas.EIP712TypeObject),
    destination: receiptDestinationFromAPI(message.destination as FinAPIComponents.Schemas.EIP712TypeObject),
    asset: receiptAssetFromAPI(message.asset as FinAPIComponents.Schemas.EIP712TypeObject),
    tradeDetails: receiptTradeDetailsFromAPI(message.tradeDetails as FinAPIComponents.Schemas.EIP712TypeObject),
    transactionDetails: receiptTransactionDetailsFromAPI(message.transactionDetails as FinAPIComponents.Schemas.EIP712TypeObject),
    quantity: message.quantity as FinAPIComponents.Schemas.EIP712TypeString,
    signature
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

const instructionParamsFromAPI = (op: FinAPIComponents.Schemas.ExecutionPlanOperation): {
  asset: FinAPIComponents.Schemas.Asset,
  source: string,
  destination: string,
  amount: string,
  signature: FinAPIComponents.Schemas.Signature | undefined
} => {
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
      return {
        asset: {} as FinAPIComponents.Schemas.Asset,
        source: "",
        destination: "",
        amount: "",
        signature: undefined
      };
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
        nonce: message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
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
        nonce: message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
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
        nonce: message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
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
        nonce: message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
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
        nonce: message.nonce as FinAPIComponents.Schemas.EIP712TypeString,
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

const termFromAPI = (term: FinAPIComponents.Schemas.EIP712TypeObject): Term => {
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

const receiptSourceFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptSource => {
  return {
    accountType: obj.accountType as FinAPIComponents.Schemas.EIP712TypeString as EIP712AccountType,
    finId: obj.finId as FinAPIComponents.Schemas.EIP712TypeString
  };
};

const receiptDestinationFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptDestination => {
  return {
    accountType: obj.accountType as FinAPIComponents.Schemas.EIP712TypeString as EIP712AccountType,
    finId: obj.finId as FinAPIComponents.Schemas.EIP712TypeString
  };
};

const receiptAssetFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptAsset => {
  return {
    assetId: obj.assetId as FinAPIComponents.Schemas.EIP712TypeString,
    assetType: obj.assetType as FinAPIComponents.Schemas.EIP712TypeString as EIP712AssetType
  };
};

const receiptTradeDetailsFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptTradeDetails => {
  return {
    executionContext: receiptExecutionPlanFromAPI(obj.executionContext as FinAPIComponents.Schemas.EIP712TypeObject)
  };
};

const receiptExecutionPlanFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptExecutionContext => {
  return {
    executionPlanId: obj.executionContext as FinAPIComponents.Schemas.EIP712TypeString,
    instructionSequenceNumber: obj.executionContext as FinAPIComponents.Schemas.EIP712TypeString
  };
};

const receiptTransactionDetailsFromAPI = (obj: FinAPIComponents.Schemas.EIP712TypeObject): EIP712ReceiptTransactionDetails => {
  return {
    operationId: obj.executionContext as FinAPIComponents.Schemas.EIP712TypeString,
    transactionId: obj.executionContext as FinAPIComponents.Schemas.EIP712TypeString
  };
};


