import { CommonService } from './common';
import { extractAssetId } from './mapping';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { logger } from '../helpers/logger';

export class TokenService extends CommonService {

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    const assetId = extractAssetId(request.asset);

    // We do deploy ERC20 here and then associate it with the FinP2P assetId,
    // in a real-world scenario, the token could already deployed in another tokenization application,
    // so we would just associate the assetId with existing token address
    try {
      const tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
        this.finP2PContract.finP2PContractAddress);

      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    try {
      const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);
      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error issuing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const nonce = request.nonce;
    const assetId = extractAssetId(request.asset);
    const sourceFinId = request.source.finId;
    const destinationFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    let settlementHash = '';
    if (request.signature.template.hashGroups.length > 1) {
      settlementHash = request.signature.template.hashGroups[1].hash;
    }
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    try {
      const txHash = await this.finP2PContract.transfer(nonce, assetId, sourceFinId, destinationFinId, amount, settlementHash, hash, signature);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error transferring asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    if (request.asset.type !== 'finp2p') {
      throw new Error(`Unsupported asset type: ${request.asset.type}`);
    }
    const nonce = request.nonce;
    const assetId = request.asset.resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    try {
      const txHash = await this.finP2PContract.redeem(nonce, assetId, finId, amount, settlementHash, hash, signature);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error redeeming asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as Components.Schemas.ReceiptOperation;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

}

