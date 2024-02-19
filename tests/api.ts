import axios from "axios";
import {ADAPTER_HOST} from "./configuration";


export class TokensAPI {

  public static async createAsset(req: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    return await post("/assets/create", req) as Paths.IssueAssets.Responses.$200;
  }

  public static async issue(req: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    return await post("/assets/issue", req) as Paths.IssueAssets.Responses.$200;
  }

  public static async redeem(req: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    return await post("/assets/redeem", req) as Paths.RedeemAssets.Responses.$200;
  }

  public static async transfer(req: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    return await post("/assets/transfer", req) as Paths.TransferAsset.Responses.$200;
  }

}

export class EscrowAPI {

  public static async hold(req: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    return await post("/assets/hold", req) as Paths.HoldOperation.Responses.$200;
  }

  public static async release(req: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    return await post("/assets/release", req) as Paths.ReleaseOperation.Responses.$200;
  }

  public static async rollback(req: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    return await post("/assets/rollback", req) as Paths.RollbackOperation.Responses.$200;
  }
}

export class PaymentsAPI {

  public static async getDepositInstruction(req: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    return await post("/payments/depositInstruction", req) as Paths.DepositInstruction.Responses.$200;
  }

  public static async payout(req: Paths.Payout.RequestBody): Promise<Paths.Payout.Responses.$200> {
    return await post("/payments/payout", req) as Paths.Payout.Responses.$200;
  }
}


export class CommonAPI {

  public static async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    return await post(`/assets/receipt/${id}`) as Paths.GetReceipt.Responses.$200;
  }

  public static async getOperationStatus(id: Paths.GetOperation.Parameters.Cid): Promise<Paths.GetOperation.Responses.$200> {
    return await get(`/operations/status/${id}`) as Paths.GetOperation.Responses.$200;
  }

  public static async balance(req: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    return await post("/assets/getBalance", req) as Paths.GetAssetBalance.Responses.$200;
  }

  public static async waitForReceipt(id: string, tries: number = 30): Promise<Components.Schemas.Receipt> {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id)
      if (status.type === "receipt") {
        if (status.operation.isCompleted) {
          return (status.operation as Components.Schemas.ReceiptOperation).response!
        }
      } else {
        throw new Error(`wrong status type, deposit expected, got: ${status.type}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`)
  }

  public static async waitForCompletion(id: string, tries: number = 3000) {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.operation.isCompleted) {
        return
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`)
  }
}


export class OperatorAPI {

  public static async setBalance(req: SetBalanceRequest): Promise<SetBalanceResponse> {
    return await post("/operator/setBalance", req) as SetBalanceResponse;
  }
}

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


const get = (url: string) =>
  new Promise((resolve, reject) => {
    axios.get(`${ADAPTER_HOST}${url}`, {
      headers: {
        'Accept': 'application/json',
      },
    }).then(({data: response}) => {
      resolve(response);
    }).catch((error: Error) => {
      console.log('error', error);
      reject(error.message);
    })
  });

const post = (url: string, data?: any, idempotencyKey?: string) =>
  new Promise((resolve, reject) => {
    axios.post(`${ADAPTER_HOST}${url}`, data, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    }).then(({data: response}) => {
      resolve(response);
    }).catch((error: Error) => {
      console.log('error', error);
      reject(error.message);
    })
  });