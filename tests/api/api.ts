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

  public async createAsset(req: FinAPIOperationalPaths.CreateAsset.RequestBody): Promise<FinAPIOperationalPaths.CreateAsset.Responses.$200> {
    return await this.post("/assets/create", req);
  }

  public async issue(req: FinAPIOperationalPaths.IssueAssets.RequestBody): Promise<FinAPIOperationalPaths.IssueAssets.Responses.$200> {
    return await this.post("/assets/issue", req);
  }

  public async redeem(req: FinAPIOperationalPaths.RedeemAssets.RequestBody): Promise<FinAPIOperationalPaths.RedeemAssets.Responses.$200> {
    return await this.post("/assets/redeem", req);
  }

  public async transfer(req: FinAPIOperationalPaths.TransferAsset.RequestBody): Promise<FinAPIOperationalPaths.TransferAsset.Responses.$200> {
    return await this.post("/assets/transfer", req);
  }

}

export class EscrowAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async hold(req: FinAPIOperationalPaths.HoldOperation.RequestBody): Promise<FinAPIOperationalPaths.HoldOperation.Responses.$200> {
    return await this.post("/assets/hold", req);
  }

  public async release(req: FinAPIOperationalPaths.ReleaseOperation.RequestBody): Promise<FinAPIOperationalPaths.ReleaseOperation.Responses.$200> {
    return await this.post("/assets/release", req);
  }

  public async rollback(req: FinAPIOperationalPaths.RollbackOperation.RequestBody): Promise<FinAPIOperationalPaths.RollbackOperation.Responses.$200> {
    return await this.post("/assets/rollback", req);
  }
}

export class PaymentsAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getDepositInstruction(req: FinAPIOperationalPaths.DepositInstruction.RequestBody): Promise<FinAPIOperationalPaths.DepositInstruction.Responses.$200> {
    return await this.post("/payments/depositInstruction", req);
  }

  public async payout(req: FinAPIOperationalPaths.Payout.RequestBody): Promise<FinAPIOperationalPaths.Payout.Responses.$200> {
    return await this.post("/payments/payout", req);
  }
}


export class CommonAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getReceipt(id: FinAPIOperationalPaths.GetReceipt.Parameters.TransactionId): Promise<FinAPIOperationalPaths.GetReceipt.Responses.$200> {
    return await this.post(`/assets/receipt/${id}`);
  }

  public async getOperationStatus(id: FinAPIOperationalPaths.GetOperation.Parameters.Cid): Promise<FinAPIOperationalPaths.GetOperation.Responses.$200> {
    return await this.get(`/operations/status/${id}`);
  }

  public async balance(req: FinAPIOperationalPaths.GetAssetBalance.RequestBody): Promise<FinAPIOperationalPaths.GetAssetBalance.Responses.$200> {
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

