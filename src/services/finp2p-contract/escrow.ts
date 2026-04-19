import { EIP712Template, EscrowService, Signature, logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  Asset, Destination, ExecutionContext,
  failedReceiptOperation, pendingReceiptOperation, ReceiptOperation, Source, ValidationError,
  EthereumTransactionError
} from "@owneraio/finp2p-contracts";
import { CommonServiceImpl } from "./common";
import { emptyOperationParams, extractBusinessDetails } from "./helpers";
import { validateRequest } from "./validator";

export class EscrowServiceImpl extends CommonServiceImpl implements EscrowService {

  public async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, ast: Asset,
    quantity: string, sgn: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature, template } = sgn;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, operationId, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, signature);

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }


  }

  public async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    try {
      await this.ensureCredential(source.finId);
      await this.ensureCredential(destination.finId);
      const transactionReceipt = await this.finP2PContract.releaseTo(operationId, source.finId, destination.finId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  public async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      await this.ensureCredential(source.finId);
      const transactionReceipt = await this.finP2PContract.releaseBack(operationId, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }


}

