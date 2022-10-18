import { logger } from '../helpers/logger';
import { v4 as uuid } from 'uuid';
import { Transaction, CommonService } from './common';

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

    let tx = {
      id: uuid(),
      source: request.source,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });

    const amount = parseInt(request.quantity);
    this.accountService.credit(request.destination.finId, amount, request.asset);

    let tx = {
      id: uuid(),
      destination: request.destination,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });

    const amount = parseInt(request.quantity);
    this.accountService.credit(request.source.finId, amount, request.asset);

    let tx = {
      id: uuid(),
      destination: request.source,
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

}

