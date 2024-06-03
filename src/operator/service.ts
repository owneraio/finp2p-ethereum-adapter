import { CommonService } from '../services/common';
import { extractAssetId } from './mapping';

export class OperatorService extends CommonService {

  public async setBalance(request: OpPaths.OperatorSetBalance.Post.RequestBody): Promise<OpPaths.OperatorSetBalance.Post.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const issuerFinId = request.to.finId;
    const amount = parseInt(request.balance);
    const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);
    await this.finP2PContract.waitForCompletion(txHash);

    return {
      isCompleted: true,
    } as Components.Schemas.ReceiptOperation;
  }


}

