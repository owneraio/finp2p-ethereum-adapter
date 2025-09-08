import { logger } from "../../helpers/logger";
import { CommonService } from "./common";
import { EthereumTransactionError } from "../../../finp2p-contracts/src/contracts/model";
import {
  Asset, Destination, EIP712Template, ExecutionContext,
  failedReceiptResult, pendingReceiptResult, ReceiptResult, Signature, Source
} from "../model";
import { extractEIP712Params } from "../mapping";

export class EscrowService extends CommonService {

  public async hold(nonce: string, source: Source, destination: Destination, ast: Asset,
                    quantity: string, sgn: Signature, operationId: string, executionContext: ExecutionContext
  ): Promise<ReceiptResult>  {
    try {
      const { signature, template } = sgn;
      const eip712Template = template as EIP712Template;
      const eip712Params = extractEIP712Params(ast, source, destination, operationId, eip712Template, executionContext);
      this.validateRequest(source, destination, quantity, eip712Params);
      const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;

      const txHash = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId,
        asset, settlement, loan, params, signature);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }

      return pendingReceiptResult(txHash);

    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);

      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }
  }

  // public async releaseTo(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
  public async release(destination: Destination, asset: Asset, quantity: string, operationId: string,
          executionContext: ExecutionContext
  ): Promise<ReceiptResult> {
    // const { operationId, destination, quantity, executionContext } = request;
    try {
      const txHash = await this.finP2PContract.releaseTo(operationId, destination.finId, quantity);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }
      return pendingReceiptResult(txHash);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);
      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }
  }

  // public async releaseBack(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
  public async rollback(asset: Asset, quantity: string, operationId: string,
           executionContext: ExecutionContext
  ): Promise<ReceiptResult> {

    try {
      const txHash = await this.finP2PContract.releaseBack(operationId);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }
      return pendingReceiptResult(txHash);
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);

      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }
  }




}

