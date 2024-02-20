import { CommonService } from './common';


export interface Source {
  finId: string,
}

export interface CurrencyCode {
  code: string;
}

export interface Asset {
  type: string,
  code: CurrencyCode
}

export interface SetBalanceRequest {
  to: Source;
  asset: Asset;
  balance: string;
}

export interface SetBalanceResponse {
  isCompleted: boolean;
  cid: string;
  response: Components.Schemas.Receipt;
}

export class OperatorService extends CommonService {

  public async setBalance(request: SetBalanceRequest): Promise<SetBalanceResponse> {
    const assetId = request.asset.code.code;
    const finId = request.to.finId;
    const amount = parseInt(request.balance);

    const txHash = await this.finP2PContract.issue(assetId, finId, amount);
    return {
      isCompleted: false,
      cid: txHash,
    } as SetBalanceResponse;
  }

}
