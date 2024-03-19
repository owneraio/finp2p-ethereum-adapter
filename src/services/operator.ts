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

    await this.createAssetIfNotExists(assetId);

    const txHash = await this.finP2PContract.issue(assetId, finId, amount);
    return {
      isCompleted: false,
      cid: txHash,
    } as SetBalanceResponse;
  }

  private async createAssetIfNotExists(assetId: string) {
    if (!await this.isAssetExists(assetId)) {
      const tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
        this.finP2PContract.finP2PContractAddress);

      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
      return this.waitForCompletion(txHash);
    }
  }

  private async isAssetExists(assetId: string) {
    try {
      await this.finP2PContract.finP2P.getAssetAddress(assetId);
    } catch (e) {
      // @ts-ignore
      if (e.reason === 'Asset not found') {
        return false;
      } else {
        throw e;
      }
    }
    return true;
  }

  private async waitForCompletion(txHash: string, tries: number = 300) {
    for (let i = 1; i < tries; i++) {
      const txReceipt = await this.finP2PContract.provider.getTransactionReceipt(txHash);
      if (txReceipt !== null) {
        if (txReceipt.status === 1) {
          return;
        } else {
          throw new Error(`transaction failed: ${txHash}`);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }

}
