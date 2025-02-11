import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { extractAssetId, failedTransaction, holdParameterFromTemplate } from "./mapping";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { operationId, source,
      destination, nonce } = request;
    const settlementAsset = extractAssetId(request.asset);
    const settlementAmount = request.quantity;
    const buyerFinId = source.finId;
    const sellerFinId = destination?.finId || '';

    const { signature, template } = request.signature;

    try {
      const {/* hashType,*/ amount, asset } = holdParameterFromTemplate(template);
      let txHash: string;
      switch (request.asset.type) {
        case "finp2p":
          txHash = await this.finP2PContract.holdAssets(operationId, nonce, asset, sellerFinId, buyerFinId, parseInt(amount),
            settlementAsset, settlementAmount, /*hashType,*/ signature);
          break

        case 'cryptocurrency': case "fiat":
          txHash = await this.finP2PContract.holdPayments(operationId, nonce, asset, sellerFinId, buyerFinId, amount,
            settlementAsset, parseInt(settlementAmount), /*hashType,*/ signature);
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
    const operationId = request.operationId;
    const buyerFinId = request.destination.finId;

    try {
      const txHash = await this.finP2PContract.release(operationId, buyerFinId);

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

