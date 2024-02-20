import { CommonService } from './common';
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

  public async setBalance(request: SetBalanceRequest): Promise<SetBalanceResponse> {
    return {
      isCompleted: true,
      // cid: uuid(),
      // response: Transaction.toReceipt(tx),
    } as SetBalanceResponse;
  }

}
