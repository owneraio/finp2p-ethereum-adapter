import { logger } from '../helpers/logger';
import { Transaction } from './accounts';
import { v4 as uuid } from 'uuid';
import { CommonService } from './common';

let service: EscrowService;


export class EscrowService extends CommonService {

  public static GetService(): EscrowService {
    if (!service) {
      service = new EscrowService();
    }
    return service;
  }

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });

    const amount = parseInt(request.quantity);
    this.accountService.debit(request.source.finId, amount, request.asset);

    const txId = uuid();
    this.transactions[txId] = {
      id: txId,
      source: request.source.finId,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;

    return {
      isCompleted: true,
      cid: txId,
    } as Components.Schemas.ReceiptOperation;
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });

    const amount = parseInt(request.quantity);
    this.accountService.credit(request.destination.finId, amount, request.asset);

    const txId = uuid();
    this.transactions[txId] = {
      id: txId,
      destination: request.destination.finId,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;

    return {
      isCompleted: true,
      cid: txId,
    } as Components.Schemas.ReceiptOperation;
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });

    const amount = parseInt(request.quantity);
    this.accountService.credit(request.source.finId, amount, request.asset);

    const txId = uuid();
    this.transactions[txId] = {
      id: txId,
      destination: request.source.finId,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;

    return {
      isCompleted: true,
      cid: txId,
    } as Components.Schemas.ReceiptOperation;
  }

}

