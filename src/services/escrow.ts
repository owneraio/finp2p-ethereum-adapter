import {
  Asset, Destination, EIP712Template, ExecutionContext,
  failedReceiptOperation, pendingReceiptOperation, ReceiptOperation, Signature, Source, EscrowService, ValidationError
} from "@owneraio/finp2p-adapter-models";
import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { CommonServiceImpl } from "./common";
import { extractBusinessDetails } from "./helpers";
import { EthereumTransactionError } from "@owneraio/finp2p-contracts";
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

    let txHash: string;
    try {
      txHash = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, signature);
    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }

    return pendingReceiptOperation(txHash, undefined);
  }

  public async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    let txHash: string;
    try {
      txHash = await this.finP2PContract.releaseTo(operationId, source.finId, destination.finId, quantity);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }
    return pendingReceiptOperation(txHash, undefined);
  }

  public async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    let txHash: string;
    try {
      txHash = await this.finP2PContract.releaseBack(operationId);
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }
    return pendingReceiptOperation(txHash, undefined);
  }


}

