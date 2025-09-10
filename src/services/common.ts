import {
  logger, CommonService, HealthService, Destination,
  OperationStatus,
  Source,
  ReceiptOperation,
  PolicyGetter,
  failedReceiptOperation,
  pendingReceiptOperation,
  successfulReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { ProofDomain } from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/finp2p";
import {
  DOMAIN_TYPE,
  RECEIPT_PROOF_TYPES,
  EIP712Domain,
  LegType,
  PrimaryType,
  FinP2PContract,
  ExecutionContext,
  FinP2PReceipt,
  Phase,
  receiptToEIP712Message,
  truncateDecimals
} from "../../finp2p-contracts/src/contracts";

import { assetTypeToService, receiptToService } from "./mapping";
import { EIP712Params, RequestValidationError } from "./model";

export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;

  getExecutionContext(txHash: string): ExecutionContext;
}

export class CommonServiceImpl implements CommonService, HealthService {

  finP2PContract: FinP2PContract;
  policyGetter: PolicyGetter | undefined;
  execDetailsStore: ExecDetailsStore | undefined;
  defaultDecimals: number;

  constructor(
    finP2PContract: FinP2PContract,
    policyGetter: PolicyGetter | undefined,
    execDetailsStore: ExecDetailsStore | undefined,
    defaultDecimals: number = 18
  ) {
    this.finP2PContract = finP2PContract;
    this.policyGetter = policyGetter;
    this.execDetailsStore = execDetailsStore;
    this.defaultDecimals = defaultDecimals;
  }

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    try {
      let finp2pReceipt = await this.finP2PContract.getReceipt(id);
      finp2pReceipt.quantity = truncateDecimals(finp2pReceipt.quantity, this.defaultDecimals);
      const receipt = await this.ledgerProof(finp2pReceipt);
      return successfulReceiptOperation(receiptToService(receipt));

    } catch (e) {
      return failedReceiptOperation(1, `${e}`);
    }
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    try {
      const status = await this.finP2PContract.getOperationStatus(cid);
      switch (status.status) {
        case "completed":
          let { receipt } = status;
          receipt.quantity = truncateDecimals(receipt.quantity, this.defaultDecimals);
          const executionContext = this.execDetailsStore?.getExecutionContext(receipt.id);
          if (executionContext) {
            logger.info("Found execution context for receipt", executionContext);
            receipt = { ...receipt, tradeDetails: { executionContext } };
          } else {
            logger.info("No execution context found for receipt", { receiptId: receipt.id });
          }
          const receiptResponse = receiptToService(await this.ledgerProof(receipt));
          return successfulReceiptOperation(receiptResponse);

        case "pending":
          return pendingReceiptOperation(cid);

        case "failed":
          return failedReceiptOperation(status.error.code, status.error.message);
      }
    } catch (e) {
      logger.error(`Got error: ${e}`);
      throw e;
    }
  }

  protected validateRequest(source: Source, destination: Destination | undefined, quantity: string, eip712Params: EIP712Params): void {
    const {
      buyerFinId,
      sellerFinId,
      asset,
      settlement,
      loan,
      params: { eip712PrimaryType, phase, leg }
    } = eip712Params;
    if (eip712PrimaryType === PrimaryType.Loan) {
      switch (phase) {
        case Phase.Initiate:
          switch (leg) {
            case LegType.Asset:
              if (destination && buyerFinId !== destination.finId) {
                throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
              }
              if (sellerFinId !== source.finId) {
                throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
              }
              if (quantity !== asset.amount) {
                throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
              }
              break;
            case LegType.Settlement:
              if (destination && sellerFinId !== destination.finId) {
                throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
              }
              if (buyerFinId !== source.finId) {
                throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
              }
              if (quantity !== loan.borrowedMoneyAmount) {
                throw new RequestValidationError(`BorrowedMoneyAmount in the signature does not match the requested quantity`);
              }
              break;
          }
          break;
        case Phase.Close:
          switch (leg) {
            case LegType.Asset:
              if (destination && sellerFinId !== destination.finId) {
                throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
              }
              if (buyerFinId !== source.finId) {
                throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
              }
              if (quantity !== asset.amount) {
                throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
              }
              break;
            case LegType.Settlement:
              if (destination && buyerFinId !== destination.finId) {
                throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
              }
              if (sellerFinId !== source.finId) {
                throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
              }
              if (quantity !== loan.returnedMoneyAmount) {
                throw new RequestValidationError(`ReturnedMoneyAmount in the signature does not match the requested quantity`);
              }
              break;
          }
      }
    } else {
      switch (leg) {
        case LegType.Asset:
          if (destination && buyerFinId !== destination.finId) {
            throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
          }
          if (sellerFinId !== source.finId) {
            throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
          }
          if (quantity !== asset.amount) {
            throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
          }
          break;
        case LegType.Settlement:
          if (destination && sellerFinId !== destination.finId) {
            throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
          }
          if (buyerFinId !== source.finId) {
            throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
          }
          if (quantity !== settlement.amount) {
            throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
          }
          break;
      }
    }

  }


  private async ledgerProof(receipt: FinP2PReceipt): Promise<FinP2PReceipt> {
    if (this.policyGetter === undefined) {
      return receipt;
    }
    const { assetId, assetType } = receipt;
    const policy = await this.policyGetter.getPolicy(assetId, assetTypeToService(assetType));
    switch (policy.type) {
      case "NoProofPolicy":
        receipt.proof = {
          type: "no-proof"
        };
        return receipt;

      case "SignatureProofPolicy":
        const { signatureTemplate, domain: policyDomain } = policy;
        if (signatureTemplate !== "EIP712") {
          throw new Error(`Unsupported signature template: ${signatureTemplate}`);
        }
        if (policyDomain !== null) {
          logger.info("Using domain from asset metadata: ", policyDomain);
        }
        const domain = await this.getDomain(policyDomain);
        const types = RECEIPT_PROOF_TYPES;
        const message = receiptToEIP712Message(receipt);
        const primaryType = "Receipt";

        logger.info("Signing receipt with EIP712", { primaryType, domain, types, message });
        const {
          hash,
          signature
        } = await this.finP2PContract.signEIP712(domain.chainId, domain.verifyingContract, types, message);

        logger.info("Receipt signed", { hash, signature });

        // ethers doesn't allow to pass an eip712 domain in a list of types, but the domain is required on a router side
        const extendedType = { ...DOMAIN_TYPE, ...types };
        receipt.proof = {
          type: "signature-proof",
          template: { primaryType, domain, types: extendedType, hash, message },
          signature
        };

        return receipt;
    }
  }

  private async getDomain(policyDomain: ProofDomain | null): Promise<EIP712Domain> {
    const domain = await this.finP2PContract.eip712Domain();
    if (policyDomain !== null) {
      return { ...domain, ...policyDomain }; // merge domains
    }
    return domain;
  }
}
