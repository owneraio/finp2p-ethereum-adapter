import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });
   
    const { operationId, source,
      destination, nonce } = request;

    const buyerFinId = source.finId;
    const sellerFinId = destination?.finId || '';

    const { signature, template } = request.signature;

    let txHash = '';
    try {
      switch (template.type) {
        case 'hashList': {
          const assetId = template.hashGroups[0].fields.find((field) => field.name === 'assetId')?.value || '';
          const amount = parseInt(template.hashGroups[0].fields.find((field) => field.name === 'amount')?.value || '');
          const settlementAsset = template.hashGroups[1].fields.find((field) => field.name === 'assetId')?.value || '';
          const settlementAmount = parseInt(template.hashGroups[1].fields.find((field) => field.name === 'amount')?.value || '');

          txHash = await this.finP2PContract.hold(operationId, nonce, assetId, sellerFinId, buyerFinId,
            amount, settlementAsset, settlementAmount, signature);

          break;
        }
        case 'EIP712': {
          const { asset, settlement } = template.message;
          const { assetId, amount } = asset.fields;
          const { assetId: settlementAsset, amount: settlementAmount } = settlement.fields;
          txHash = await this.finP2PContract.hold(operationId, nonce, assetId, sellerFinId, buyerFinId,
            amount, settlementAsset, settlementAmount, signature);
          break;
        }
      }

    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
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

