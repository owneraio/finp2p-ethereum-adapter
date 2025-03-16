import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { EthereumTransactionError } from "../../finp2p-contracts/src/contracts/model";
import { extractEIP712Params, failedTransaction, RequestValidationError } from "./mapping";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const eip712Params = extractEIP712Params(request);
    try {
      this.validateRequest(request, eip712Params);
    } catch (e) {
      if (e instanceof RequestValidationError) {
        logger.error(`Validation error: ${e.reason}`);
        return failedTransaction(1, e.reason);
      }
    }
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;
    const { nonce, signature: { signature } } = request;

    try {
      const txHash = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId,
        asset, settlement, loan, params, signature);

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
    const { operationId, destination, quantity } = request;
    try {
      const txHash = await this.finP2PContract.releaseTo(operationId, destination.finId, quantity);
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
    const { operationId } = request;

    try {
      const txHash = await this.finP2PContract.releaseBack(operationId);

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
    const { operationId, source, quantity } = request;
    if (!operationId) {
      logger.error('No operationId provided');
      return failedTransaction(1, "operationId is required");
    }

    try {
      const txHash = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity);
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

