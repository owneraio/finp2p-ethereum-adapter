import { logger } from '../helpers/logger';
import { AccountService } from './accounts';

export class Transaction {

  constructor(id: string, amount: number, asset: Components.Schemas.Asset, timestamp: number, source?: Components.Schemas.Source, destination?: Components.Schemas.Destination) {
    this.id = id;
    this.source = source;
    this.destination = destination;
    this.amount = amount;
    this.asset = asset;
    this.timestamp = timestamp;
  }

  id: string;

  source?: Components.Schemas.Source;

  destination?: Components.Schemas.Destination;

  amount: number;

  asset: Components.Schemas.Asset;

  timestamp: number;

  public static toReceipt(tx: Transaction): Components.Schemas.Receipt {
    return {
      id: tx.id,
      asset: tx.asset,
      quantity: `${tx.amount}`,
      source: tx.source,
      destination: tx.destination,
      timestamp: tx.timestamp,
    };
  }
}

export class CommonService {

  accountService: AccountService;

  constructor(accountService: AccountService) {
    this.accountService = accountService;
  }

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
      response: Transaction.toReceipt(tx),
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
        response: Transaction.toReceipt(tx),
      } as Components.Schemas.ReceiptOperation,
    } as Components.Schemas.OperationStatus;
  }
}

