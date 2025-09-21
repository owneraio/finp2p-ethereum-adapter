import {
  logger, CommonService, HealthService,
  OperationStatus,
  ReceiptOperation,
  failedReceiptOperation,
  pendingReceiptOperation,
  successfulReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  ExecutionContext,
  FinP2PReceipt,
  truncateDecimals
} from "../../finp2p-contracts";

import { receiptToService } from "./mapping";

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
    // const receipt = await this.ledgerProof(finp2pReceipt);
    return successfulReceiptOperation(receiptToService(finp2pReceipt));
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
          // await this.ledgerProof(receipt)
          const receiptResponse = receiptToService(receipt);
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


}
