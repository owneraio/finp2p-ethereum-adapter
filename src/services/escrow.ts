import {
  logger, Asset, Destination, EIP712Template, ExecutionContext,
  failedReceiptOperation, pendingReceiptOperation, ReceiptOperation, Signature, Source, EscrowService
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { CommonServiceImpl } from "./common";
import { extractEIP712Params } from "./helpers";
import { EthereumTransactionError } from "../../finp2p-contracts/src/contracts";

export class EscrowServiceImpl extends CommonServiceImpl implements EscrowService {

  public async hold(nonce: string, source: Source, destination: Destination | undefined, ast: Asset,
                    quantity: string, sgn: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    try {
      const { signature, template } = sgn;
      const eip712Template = template as EIP712Template;
      const eip712Params = extractEIP712Params(ast, source, destination, operationId, eip712Template, exCtx);
      this.validateRequest(source, destination, quantity, eip712Params);
      const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;

      const txHash = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId,
        asset, settlement, loan, params, signature);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }

      return pendingReceiptOperation(txHash);

    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async release(destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    try {
      const txHash = await this.finP2PContract.releaseTo(operationId, destination.finId, quantity);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }
      return pendingReceiptOperation(txHash);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async rollback(asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {

    try {
      const txHash = await this.finP2PContract.releaseBack(operationId);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }
      return pendingReceiptOperation(txHash);
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

