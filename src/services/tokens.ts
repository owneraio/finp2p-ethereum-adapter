import { CommonService } from './common';
import Finp2pAsset = Components.Schemas.Finp2pAsset;

export class TokenService extends CommonService {

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    const assetId = (request.asset as Finp2pAsset).resourceId;
    const tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
      this.finP2PContract.finP2PContractAddress);

    const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const assetId = request.asset.resourceId;
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const nonce = request.nonce;
    const assetId = (request.asset as Finp2pAsset).resourceId;
    const sourceFinId = request.source.finId;
    const destinationFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    try {
      const txHash = await this.finP2PContract.transfer(nonce, assetId, sourceFinId, destinationFinId, amount, settlementHash, hash, signature);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      return {
        isCompleted: true,
        error: {
          code: 1,
          message: e,
        },
      } as Components.Schemas.ReceiptOperation;
    }
  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const nonce = request.nonce;
    const assetId = (request.asset as Finp2pAsset).resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    const txHash = await this.finP2PContract.redeem(nonce, assetId, finId, amount, settlementHash, hash, signature);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

