import { v4 as uuid } from 'uuid';
import { Transaction } from './accounts';
import { CommonService } from './common';

let service: TokenService;


export class TokenService extends CommonService {

  public static GetService(): TokenService {
    if (!service) {
      service = new TokenService();
    }
    return service;
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
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

  public async transfer(request: Paths.Transfer.RequestBody): Promise<Paths.Transfer.Responses.$200> {
    const amount = parseInt(request.quantity);
    this.accountService.move(request.source.finId, request.destination.finId, amount, request.asset);

    const txId = uuid();
    this.transactions[txId] = {
      id: txId,
      source: request.source.finId,
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

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
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

}

