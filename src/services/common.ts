import { logger } from "../helpers/logger";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import {
  ExecutionContext,
  FinP2PReceipt,
  Phase,
  receiptToEIP712Message
} from "../../finp2p-contracts/src/contracts/model";
import { assetFromAPI, EIP712Params, receiptToAPI, RequestParams, RequestValidationError } from "./mapping";
import { PolicyGetter } from "../finp2p/policy";
import {
  DOMAIN_TYPE,
  EIP712Domain,
  LegType,
  PrimaryType,
  RECEIPT_PROOF_TYPES
} from "../../finp2p-contracts/src/contracts/eip712";
import { ProofDomain } from "../finp2p/model";
import { truncateDecimals } from "../../finp2p-contracts/src/contracts/utils";

export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;
  getExecutionContext(txHash: string): ExecutionContext;
}

export class CommonService {

  finP2PContract: FinP2PContract;
  policyGetter: PolicyGetter | undefined;
  execDetailsStore: ExecDetailsStore | undefined;
  defaultDecimals: number

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

  public async getBalance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug("getBalance", { request });

    const { assetId } = assetFromAPI(request.asset);
    const balance = await this.finP2PContract.balance(assetId, request.owner.finId);
    const truncated = truncateDecimals(balance, this.defaultDecimals);

    return {
      asset: request.asset, balance: truncated
    } as Components.Schemas.Balance;
  }

  public async balance(request: Paths.GetAssetBalanceInfo.RequestBody): Promise<Paths.GetAssetBalanceInfo.Responses.$200> {
    logger.debug("balance", { request });
    const { asset, account: { account: { finId } } } = request;
    const { assetId } = assetFromAPI(asset);
    const balance = await this.finP2PContract.balance(assetId, finId);
    const truncated = truncateDecimals(balance, this.defaultDecimals);
    return {
      account: { account: { type: "finId", finId } },
      asset: request.asset,
      balanceInfo: {
        asset,
        current: truncated,
        available: truncated,
        held: "0"
      }
    } as Components.Schemas.AssetBalanceInfoResponse;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    try {
      let finp2pReceipt = await this.finP2PContract.getReceipt(id);
      finp2pReceipt.quantity = truncateDecimals(finp2pReceipt.quantity, this.defaultDecimals);
      const receipt = await this.ledgerProof(finp2pReceipt);
      return {
        isCompleted: true, response: receiptToAPI(receipt)
      } as Components.Schemas.ReceiptOperation;

    } catch (e) {
      return {
        isCompleted: true, error: {
          code: 1, message: e
        }
      } as Components.Schemas.ReceiptOperation;
    }
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
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
          const receiptResponse = receiptToAPI(await this.ledgerProof(receipt));
          return {
            type: "receipt", operation: {
              isCompleted: true, response: receiptResponse
            }
          } as Components.Schemas.OperationStatus;

        case "pending":
          return {
            type: "receipt", operation: {
              isCompleted: false, cid: cid
            }
          } as Components.Schemas.OperationStatus;

        case "failed":
          return {
            type: "receipt", operation: {
              isCompleted: true, error: status.error
            }
          } as Components.Schemas.OperationStatus;
      }
    } catch (e) {
      logger.error(`Got error: ${e}`);
      throw e;
    }
  }

  protected validateRequest(requestParams: RequestParams, eip712Params: EIP712Params): void {
    const { source, destination, quantity } = requestParams;
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
    const policy = await this.policyGetter.getPolicy(assetId, assetType);
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
