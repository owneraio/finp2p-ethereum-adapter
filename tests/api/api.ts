import { ClientBase } from "./base";

export class APIClient {

  public readonly tokens: TokensAPI;
  public readonly escrow: EscrowAPI;
  public readonly payments: PaymentsAPI;
  public readonly common: CommonAPI;

  constructor(host: string) {
    this.tokens = new TokensAPI(host);
    this.escrow = new EscrowAPI(host);
    this.payments = new PaymentsAPI(host);
    this.common = new CommonAPI(host);
  }

  async expectReceipt(status: any): Promise<Components.Schemas.Receipt> {
    if (status.isCompleted) {
      return status.response;
    } else {
      return await this.common.waitForReceipt(status.cid);
    }
  };

  async expectBalance(owner: Components.Schemas.Source, asset: Components.Schemas.Asset, amount: number) {
    const balance = await this.common.balance({ asset: asset, owner: owner });
    expect(parseInt(balance.balance)).toBe(amount);
  };

}

export class TokensAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async createAsset(req: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    return await this.post("/assets/create", req);
  }

  public async issue(req: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    return await this.post("/assets/issue", req);
  }

  public async redeem(req: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    return await this.post("/assets/redeem", req);
  }

  public async transfer(req: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    return await this.post("/assets/transfer", req);
  }

}

export class EscrowAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async hold(req: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    return await this.post("/assets/hold", req);
  }

  public async release(req: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    return await this.post("/assets/release", req);
  }

  public async rollback(req: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    return await this.post("/assets/rollback", req);
  }
}

export class PaymentsAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getDepositInstruction(req: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    return await this.post("/payments/depositInstruction", req);
  }

  public async payout(req: Paths.Payout.RequestBody): Promise<Paths.Payout.Responses.$200> {
    return await this.post("/payments/payout", req);
  }
}


export class CommonAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    return await this.post(`/assets/receipt/${id}`);
  }

  public async getOperationStatus(id: Paths.GetOperation.Parameters.Cid): Promise<Paths.GetOperation.Responses.$200> {
    return await this.get(`/operations/status/${id}`);
  }

  public async balance(req: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    return await this.post("/assets/getBalance", req);
  }

  public async waitForReceipt(id: string, tries: number = 30): Promise<Components.Schemas.Receipt> {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.type === "receipt") {
        if (status.operation.isCompleted) {
          return (status.operation as Components.Schemas.ReceiptOperation).response!;
        }
      } else {
        throw new Error(`wrong status type, deposit expected, got: ${status.type}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }

  public async waitForCompletion(id: string, tries: number = 3000) {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.operation.isCompleted) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }
}

