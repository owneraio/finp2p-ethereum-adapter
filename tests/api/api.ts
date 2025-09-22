import {ClientBase} from "./base";
import {LedgerAPI} from "@owneraio/finp2p-nodejs-skeleton-adapter";

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

  async expectReceipt(status: any): Promise<LedgerAPI["schemas"]["receipt"]> {
    if (status.isCompleted) {
      return status.response;
    } else {
      return await this.common.waitForReceipt(status.cid);
    }
  };

  async expectBalance(owner: LedgerAPI["schemas"]["source"], asset: LedgerAPI["schemas"]["asset"], amount: number) {
    const balance = await this.common.getBalance({asset: asset, owner: owner});
    expect(parseInt(balance.balance)).toBe(amount);
  };

}

export class TokensAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async createAsset(req: LedgerAPI["schemas"]["CreateAssetRequest"]): Promise<LedgerAPI["schemas"]["CreateAssetResponse"]> {
    return await this.post("/assets/create", req);
  }

  public async issue(req: LedgerAPI["schemas"]["IssueAssetsRequest"]): Promise<LedgerAPI["schemas"]["IssueAssetsResponse"]> {
    return await this.post("/assets/issue", req);
  }

  public async redeem(req: LedgerAPI["schemas"]["RedeemAssetsRequest"]): Promise<LedgerAPI["schemas"]["RedeemAssetsResponse"]> {
    return await this.post("/assets/redeem", req);
  }

  public async transfer(req: LedgerAPI["schemas"]["TransferAssetRequest"]): Promise<LedgerAPI["schemas"]["TransferAssetResponse"]> {
    return await this.post("/assets/transfer", req);
  }

}

export class EscrowAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async hold(req: LedgerAPI["schemas"]["HoldOperationRequest"]): Promise<LedgerAPI["schemas"]["HoldOperationResponse"]> {
    return await this.post("/assets/hold", req);
  }

  public async release(req: LedgerAPI["schemas"]["ReleaseOperationRequest"]): Promise<LedgerAPI["schemas"]["ReleaseOperationResponse"]> {
    return await this.post("/assets/release", req);
  }

  public async rollback(req: LedgerAPI["schemas"]["RollbackOperationRequest"]): Promise<LedgerAPI["schemas"]["RollbackOperationResponse"]> {
    return await this.post("/assets/rollback", req);
  }
}

export class PaymentsAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getDepositInstruction(req: LedgerAPI["schemas"]["DepositInstructionRequest"]): Promise<LedgerAPI["schemas"]["DepositInstructionResponse"]> {
    return await this.post("/payments/depositInstruction", req);
  }

  public async payout(req: LedgerAPI["schemas"]["PayoutRequest"]): Promise<LedgerAPI["schemas"]["PayoutResponse"]> {
    return await this.post("/payments/payout", req);
  }
}


export class CommonAPI extends ClientBase {

  constructor(host: string) {
    super(host);
  }

  public async getReceipt(id: string): Promise<LedgerAPI["schemas"]["GetReceiptResponse"]> {
    return await this.post(`/assets/receipt/${id}`);
  }

  public async getOperationStatus(id: string): Promise<LedgerAPI["schemas"]["GetOperationStatusResponse"]> {
    return await this.get(`/operations/status/${id}`);
  }

  public async getBalance(req: LedgerAPI["schemas"]["GetAssetBalanceRequest"]): Promise<LedgerAPI["schemas"]["GetAssetBalanceResponse"]> {
    return await this.post("/assets/getBalance", req);
  }


  public async waitForReceipt(id: string, tries: number = 30): Promise<LedgerAPI["schemas"]["receipt"]> {
    for (let i = 1; i < tries; i++) {
      const status = await this.getOperationStatus(id);
      if (status.type === "receipt") {
        if (status.operation.isCompleted) {
          return (status.operation).response!;
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

