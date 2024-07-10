import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { extractAssetId } from './mapping';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });

    const operationId = request.operationId;
    const assetId = extractAssetId(request.asset);
    const buyerFinId = request.source.finId;
    const sellerFinId = request.destination?.finId || '';
    const amount = parseInt(request.quantity);
    const signature = request.signature.signature;

    let txHash = '';
    try {
      switch (request.signature.template.type) {
        case 'hashList':
          if (request.signature.template.hashGroups.length > 0) {
          }
          break;
        case 'EIP712':
          const { nonce, settlement } =  request.signature.template.message;
          const nonceDec = Buffer.from(nonce.toString(), 'base64').toString('hex');
          const { asset: settlementAsset, amount: settlementAmount } = settlement.fields;
          txHash = await this.finP2PContract.hold(operationId, nonceDec, assetId, sellerFinId,  buyerFinId,
            amount, settlementAsset, settlementAmount, signature);
          break;
      }

    } catch (e) {
      logger.error(`Error asset redeem: ${e}`);
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
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
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

