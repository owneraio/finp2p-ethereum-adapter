import { logger } from '../helpers/logger';

let service: TokenService;


export class TokenService {

  public static GetService(): TokenService {
    if (!service) {
      service = new TokenService();
    }
    return service;
  }

  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });
    return {
      asset: request.asset,
      balance: '0.00',
    } as Components.Schemas.Balance;
  }

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });

    return {
      isCompleted: true,
      response: {
        id: '',
        asset: request.asset,
        source: request.source,
        quantity: request.quantity,
      } as Components.Schemas.Receipt,
    } as Components.Schemas.ReceiptOperation;
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });

    return {
      isCompleted: true,
      response: {
        id: '1',
        asset: request.asset,
        source: request.source,
        destination: request.destination,
        quantity: request.quantity,
      } as Components.Schemas.Receipt,
    } as Components.Schemas.ReceiptOperation;
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });

    return {
      isCompleted: true,
      response: {
        id: '9fac0cbf-db57-4028-99fe-96d196488626',
        asset: request.asset,
        source: request.source,
        destination: {
          finId: request.source.finId,
          account: { type: 'finId', finId: request.source.finId },
        } as Components.Schemas.Destination,
        quantity: request.quantity,
      } as Components.Schemas.Receipt,
    } as Components.Schemas.ReceiptOperation;
  }


  //todo: sample receipt
  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    return {
      isCompleted: true,
      response: {
        id: id,
        asset: { type: 'finp2p', resourceId: '' } as Components.Schemas.Asset,
        source: { finId: '02800ccb7a40b8d09988d3ee8baa392e9120c9ce8bbf281c8178c7eb933abdd987' } as Components.Schemas.Source,
        destination: {
          finId: '03a8b65c62342beccb2c7c79a54d520c1fad354422c81389b3f23fdf07304e3dd6',
        } as Components.Schemas.Destination,
        quantity: '1000',
      } as Components.Schemas.Receipt,
    } as Components.Schemas.ReceiptOperation;
  }
}

