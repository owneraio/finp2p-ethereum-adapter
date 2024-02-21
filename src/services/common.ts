import { logger } from '../helpers/logger';
import { FinP2PContract } from '../contracts/finp2p';
import Finp2pAsset = Components.Schemas.Finp2pAsset;
import { receiptToAPI } from './mapping';


export class CommonService {

  finP2PContract: FinP2PContract;

  constructor(finP2PContract: FinP2PContract) {
    this.finP2PContract = finP2PContract;
  }

  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });

    let assetId = (request.asset as Finp2pAsset).resourceId;
    const balance = await this.finP2PContract.balance(assetId, request.owner.finId);

    return {
      asset: request.asset,
      balance: `${balance}`,
    } as Components.Schemas.Balance;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    try {
      const receipt = await this.finP2PContract.getReceipt(id);
      return {
        isCompleted: true,
        response: receiptToAPI(receipt),
      } as Components.Schemas.ReceiptOperation;

    } catch (e) {
      return {
        isCompleted: true,
        error: {
          code: 1,
          message: e,
        },
      } as Components.Schemas.ReceiptOperation;
    }
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
    const status = await this.finP2PContract.getOperationStatus(cid);
    switch (status.status) {
      case 'completed':
        let receipt = receiptToAPI(status.receipt);
        return {
          type: 'receipt',
          operation: {
            isCompleted: true,
            response: receipt,
          },
        } as Components.Schemas.OperationStatus;

      case 'pending':
        return {
          type: 'receipt',
          operation: {
            isCompleted: false,
            cid: cid,
          },
        } as Components.Schemas.OperationStatus;

      case 'failed':
        return {
          type: 'receipt',
          operation: {
            isCompleted: true,
            error: status.error,
          },
        } as Components.Schemas.OperationStatus;
    }
  }
}
