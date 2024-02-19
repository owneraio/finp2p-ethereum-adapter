import { v4 as uuid } from 'uuid';
import { Transaction, CommonService } from './common';

let service: TokenService;

export class TokenService extends CommonService {

  public static GetService(): TokenService {
    if (!service) {
      service = new TokenService();
    }
    return service;
  }

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    console.log(`request: ${request}`);
    const txId = uuid();
    return {
      isCompleted: true,
      cid: txId,
    } as Components.Schemas.EmptyOperation;
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const amount = parseInt(request.quantity);
    this.accountService.credit(request.destination.finId, amount, request.asset);

    let tx = {
      id: uuid(),
      amount: amount,
      asset: request.asset,
      timestamp: Date.now(),
      destination: {
        finId: request.destination.finId,
        account: request.destination,
      },
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: tx.id,
      response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const amount = parseInt(request.quantity);
    this.accountService.move(request.source.finId, request.destination.finId, amount, request.asset);

    let tx = {
      id: uuid(),
      source: request.source,
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

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const amount = parseInt(request.quantity);
    this.accountService.debit(request.source.finId, amount, request.asset);

    let tx = {
      id: uuid(),
      source: {
        finId: request.source.finId,
        account: request.source,
      },
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

