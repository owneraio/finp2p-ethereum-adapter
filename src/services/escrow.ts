import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { EthereumTransactionError } from "../../finp2p-contracts/src/contracts/model";
import { assetFromAPI, executionContextFromAPI, failedTransaction } from "./mapping";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const {
      asset,
      quantity,
      source: { finId: source },
      operationId,
      executionContext
    } = request;
    const { assetId, assetType } = assetFromAPI(asset);
    const exCtx = executionContextFromAPI(executionContext);

    try {
      await this.providePreviousInstructionProofIfExists(exCtx.planId, exCtx.sequence);

      const txHash = await this.finP2PContract.holdWithContext(source, "", assetId, assetType, quantity, operationId, exCtx);
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
    const {
      asset,
      quantity,
      source: { finId: source },
      destination: { finId: destination },
      operationId,
      executionContext
    } = request;
    const { assetId, assetType } = assetFromAPI(asset);
    const exCtx = executionContextFromAPI(executionContext);

    try {
      await this.providePreviousInstructionProofIfExists(exCtx.planId, exCtx.sequence);

      const txHash = await this.finP2PContract.releaseToWithContext(source, destination, assetId, assetType, quantity, operationId, exCtx);
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
    const exCtx = executionContextFromAPI(executionContext);

    try {
      await this.providePreviousInstructionProofIfExists(exCtx.planId, exCtx.sequence);

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
    const {
      asset,
      quantity,
      source: { finId: source },
      operationId,
      executionContext
    } = request;
    const { assetId, assetType } = assetFromAPI(asset);
    const exCtx = executionContextFromAPI(executionContext);
    if (!operationId) {
      logger.error('No operationId provided');
      return failedTransaction(1, "operationId is required");
    }

    try {
      await this.providePreviousInstructionProofIfExists(exCtx.planId, exCtx.sequence);

      const txHash = await this.finP2PContract.releaseAndRedeemWithContext(source, assetId, assetType, quantity, operationId, exCtx);
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

