import { logger } from '../helpers/logger';
import { AccountService, Transaction } from './accounts';


export class CommonService {

  accountService: AccountService = new AccountService();

  transactions: Record<string, Transaction> = {};

  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });
    const balance = this.accountService.getBalance(request.owner.finId, request.asset);
    return {
      asset: request.asset,
      balance: `${balance}`,
    } as Components.Schemas.Balance;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    const tx = this.transactions[id];
    if (tx === undefined) {
      throw new Error('transaction not found!');
    }
    return {
      isCompleted: true,
      response: {
        id: tx.id,
        asset: tx.asset,
        quantity: `${tx.amount}`,
        source: tx.source,
        destination: tx.destination,
        timestamp: tx.timestamp,
      } as Components.Schemas.Receipt,
    } as Components.Schemas.ReceiptOperation;
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
    const tx = this.transactions[cid];
    if (tx === undefined) {
      throw new Error('transaction not found!');
    }
    return {
      type: 'receipt', operation: {
        isCompleted: true,
        response: {
          id: tx.id,
          asset: tx.asset,
          quantity: `${tx.amount}`,
          source: tx.source,
          destination: tx.destination,
          timestamp: tx.timestamp,
        } as Components.Schemas.Receipt,
      } as Components.Schemas.ReceiptOperation,
    } as Components.Schemas.OperationStatus;
  }
}

