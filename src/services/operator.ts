import { CommonService, Transaction } from './common';
import { v4 as uuid } from 'uuid';


let service: OperatorService;


export interface Source {
  finId: string,
}

export interface CurrencyCode {
  code: string
}

export interface Asset {
  type: string,
  code: CurrencyCode
}

export interface SetBalanceRequest {
  to: Source
  asset: Asset
  balance: string
}

export interface SetBalanceResponse {
  isCompleted: boolean
  cid: string
  response: Components.Schemas.Receipt
}

export class OperatorService extends CommonService {

  public static GetService(): OperatorService {
    if (!service) {
      service = new OperatorService();
    }
    return service;
  }

  public async setBalance(request: SetBalanceRequest): Promise<SetBalanceResponse> {
    const amount = parseInt(request.balance);
    const asset = {
      type: 'fiat',
      code: request.asset.code.code,
    } as Components.Schemas.Asset;
    this.accountService.credit(request.to.finId, amount, asset);

    let tx = {
      id: uuid(),
      amount: amount,
      asset: asset,
      timestamp: Date.now(),
      destination: {
        finId: request.to.finId,
        account: {
          finId: request.to.finId,
        },
      },
    } as Transaction;
    this.transactions[tx.id] = tx;

    return {
      isCompleted: true,
      cid: uuid(),
      response: Transaction.toReceipt(tx),
    } as SetBalanceResponse;
  }

}
