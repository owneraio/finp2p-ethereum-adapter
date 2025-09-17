import {
  logger, CommonService, HealthService,
  OperationStatus,
  ReceiptOperation,
  failedReceiptOperation,
  pendingReceiptOperation,
  successfulReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient, ProofDomain } from "@owneraio/finp2p-client";
import {
  DOMAIN_TYPE,
  RECEIPT_PROOF_TYPES,
  EIP712Domain,
  FinP2PContract,
  ExecutionContext,
  FinP2PReceipt,
  receiptToEIP712Message,
  truncateDecimals
} from "../../finp2p-contracts/src";

import { assetTypeToService, receiptToService } from "./mapping";

export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;

  getExecutionContext(txHash: string): ExecutionContext;
}

export class CommonServiceImpl implements CommonService, HealthService {

  finP2PContract: FinP2PContract;
  finP2PClient: FinP2PClient | undefined;
  execDetailsStore: ExecDetailsStore | undefined;
  defaultDecimals: number;

  constructor(
    finP2PContract: FinP2PContract,
    finP2PClient: FinP2PClient | undefined,
    execDetailsStore: ExecDetailsStore | undefined,
    defaultDecimals: number = 18
  ) {
    this.finP2PContract = finP2PContract;
    this.finP2PClient = finP2PClient;
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
    let finp2pReceipt: FinP2PReceipt;
    try {
      finp2pReceipt = await this.finP2PContract.getReceipt(id);
    } catch (e) {
      return failedReceiptOperation(1, `${e}`);
    }
    finp2pReceipt.quantity = truncateDecimals(finp2pReceipt.quantity, this.defaultDecimals);
    const receipt = await this.ledgerProof(finp2pReceipt);
    return successfulReceiptOperation(receiptToService(receipt));
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
          return pendingReceiptOperation(cid, undefined);

        case "failed":
          return failedReceiptOperation(status.error.code, status.error.message);
      }
    } catch (e) {
      logger.error(`Got error: ${e}`);
      throw e;
    }
  }


  private async ledgerProof(receipt: FinP2PReceipt): Promise<FinP2PReceipt> {
    if (this.finP2PClient === undefined) {
      return receipt;
    }
    const { assetId, assetType } = receipt;
    const policy = await this.finP2PClient.getAssetProofPolicy(assetId, assetTypeToService(assetType));
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
