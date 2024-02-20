import { logger } from '../helpers/logger';


export class CommonService {


  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });
    const balance = 0
    return {
      asset: request.asset,
      balance: `${balance}`,
    } as Components.Schemas.Balance;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    return {
      isCompleted: true,
      response: undefined, //todo: implement
    } as Components.Schemas.ReceiptOperation;
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
    return {
      type: 'receipt', operation: {
        isCompleted: true,
        response: undefined, //todo: implement
      } as Components.Schemas.ReceiptOperation,
    } as Components.Schemas.OperationStatus;
  }
}

