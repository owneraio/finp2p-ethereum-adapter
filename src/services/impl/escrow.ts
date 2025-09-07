import { logger } from "../../helpers/logger";
import { CommonService } from "./common";
import { EthereumTransactionError } from "../../../finp2p-contracts/src/contracts/model";
import { extractEIP712Params, failedTransaction, RequestParams } from "../../routes/mapping";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { executionContext } = request;
    try {
      const requestParams: RequestParams = { ...request, type: "hold" };
      const eip712Params = extractEIP712Params(requestParams);
      this.validateRequest(requestParams, eip712Params);
      const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;
      const { nonce, signature: { signature } } = request;

      const txHash = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId,
        asset, settlement, loan, params, signature);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.executionPlanId, executionContext.instructionSequenceNumber);
      }

      return {
        isCompleted: false, cid: txHash
      } as Components.Schemas.ReceiptOperation;

    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async releaseTo(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    const { operationId, destination, quantity, executionContext } = request;
    try {
      const txHash = await this.finP2PContract.releaseTo(operationId, destination.finId, quantity);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.executionPlanId, executionContext.instructionSequenceNumber);
      }
      return {
        isCompleted: false, cid: txHash
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);
      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async releaseBack(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    const { operationId, executionContext } = request;

    try {
      const txHash = await this.finP2PContract.releaseBack(operationId);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.executionPlanId, executionContext.instructionSequenceNumber);
      }
      return {
        isCompleted: false, cid: txHash
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async releaseAndRedeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const { operationId, source, quantity, executionContext } = request;
    if (!operationId) {
      logger.error("No operationId provided");
      return failedTransaction(1, "operationId is required");
    }

    try {
      const txHash = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.executionPlanId, executionContext.instructionSequenceNumber);
      }
      return {
        isCompleted: false, cid: txHash
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);
      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }


}

