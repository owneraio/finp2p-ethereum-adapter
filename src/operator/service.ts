import { CommonService } from '../services/common';
import { extractAssetId } from './mapping';
import { logger } from "../helpers/logger";

export class OperatorService extends CommonService {

  public async setBalance(request: OpPaths.OperatorSetBalance.Post.RequestBody): Promise<OpPaths.OperatorSetBalance.Post.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const issuerFinId = request.to.finId;
    const amount = parseInt(request.balance);

    logger.debug(`Setting balance of ${assetId} to ${issuerFinId}`)
    const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);
    await this.finP2PContract.waitForCompletion(txHash);
    logger.debug('Balance minted')
    return {
      isCompleted: true,
    } as Components.Schemas.ReceiptOperation;
  }


}

