import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { extractAssetId } from './mapping';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });

    const operationId = request.operationId;
    const assetId = extractAssetId(request.asset);
    const sourceFinId = request.source.finId;
    const destinationFinId = request.destination?.finId || '';
    const amount = parseInt(request.quantity);
    const expiry = request.expiry;
    const assetHash = request.signature.template.hashGroups[0].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    try {
      const txHash = await this.finP2PContract.hold(operationId, assetId, sourceFinId, destinationFinId, amount, expiry, assetHash, hash, signature);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error holding asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }


  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });

    const operationId = request.operationId;
    const destinationFinId = request.destination.finId;

    try {
      const txHash = await this.finP2PContract.release(operationId, destinationFinId);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    }  catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });
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
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

}

