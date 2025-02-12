import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { extractAssetId, failedTransaction, holdParameterFromTemplate } from "./mapping";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { operationId, asset, source, destination, quantity, nonce } = request;
    const buyerFinId = source.finId;
    const sellerFinId = destination?.finId || '';
    const { signature, template } = request.signature;

    try {
      const {/* hashType,*/ assetId, assetAmount, settlementAsset, settlementAmount } = holdParameterFromTemplate(template);
      let txHash: string;
      switch (asset.type) {
        case "finp2p":
          if (asset.resourceId !== assetId) {
            return failedTransaction(1, `Requested asset id for finp2p asset does not match the asset id in the template`);
          }
          if (assetAmount !== quantity) {
            return failedTransaction(1, `Requested asset amount for finp2p asset does not match the asset amount in the template`);
          }

          txHash = await this.finP2PContract.holdAssets(operationId, nonce, assetId, sellerFinId, buyerFinId, assetAmount,
            settlementAsset, settlementAmount, /*hashType,*/ signature);
          break

        case "fiat":
        case "cryptocurrency":
          if (asset.code !== settlementAsset) {
            return failedTransaction(1, `Requested settlement asset code does not match the settlement asset code in the template`);
          }
          if (settlementAmount !== quantity) {
            return failedTransaction(1, `Requested settlement amount does not match the settlement amount in the template`);
          }

          txHash = await this.finP2PContract.holdPayments(operationId, nonce, assetId, sellerFinId, buyerFinId, assetAmount,
            settlementAsset, settlementAmount, /*hashType,*/ signature);

          break
      }

      return {
        isCompleted: false,
        cid: txHash,
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

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    const { operationId, destination, quantity} = request;

    try {
      const txHash = await this.finP2PContract.release(operationId, destination.finId, quantity);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    }  catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);
      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    const operationId = request.operationId;

    try {
      const txHash = await this.finP2PContract.rollback(operationId);

      return {
        isCompleted: false,
        cid: txHash,
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

}

