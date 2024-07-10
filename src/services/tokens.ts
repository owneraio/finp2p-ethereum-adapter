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
    const amount = parseInt(request.quantity);

    let txHash: string;
    try {
      switch (request.signature.template.type) {
        case 'hashList': {
          txHash = await this.finP2PContract.issueWithoutSignature(assetId, request.destination.finId, amount);
          break;
        }

        case 'EIP712': {
          const { nonce, issuer, buyer,
            settlement } = request.signature.template.message;
          const nonceDec = Buffer.from(nonce.toString(), 'base64').toString('hex');
          const buyerFinId = buyer.fields.key; // should be equal to request.destination.finId
          const issuerFinId = issuer.fields.key;
          const signature = request.signature.signature;

          txHash = await this.finP2PContract.issue(nonceDec, assetId, buyerFinId, issuerFinId, amount,
            settlement.fields.assetId, settlement.fields.amount, signature);
          break;
        }

        default:
          txHash = '';
          break;
      }
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
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
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const nonce = request.nonce;
    const assetId = extractAssetId(request.asset);
    const sellerFinId = request.source.finId;
    const buyerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const signature = request.signature.signature;

    let txHash = '';
    try {
      switch (request.signature.template.type) {
        case 'hashList': {
          txHash = await this.finP2PContract.transfer(nonce, assetId,
            sellerFinId, buyerFinId, amount, '', 0, signature);
          break;
        }

        case 'EIP712': {
          const { settlement } = request.signature.template.message;
          const { asset: settlementAsset, amount: settlementAmount } = settlement.fields;
          txHash = await this.finP2PContract.transfer(nonce, assetId,
            sellerFinId, buyerFinId, amount, settlementAsset, settlementAmount, signature);
          break;
        }

        default:
          txHash = '';
          break;
      }
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
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
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    if (request.asset.type !== 'finp2p') {
      throw new Error(`Unsupported asset type: ${request.asset.type}`);
    }
    const nonce = request.nonce;
    const assetId = request.asset.resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    const signature = request.signature.signature;

    let txHash = '';
    try {
      switch (request.signature.template.type) {
        case 'hashList': {
          txHash = await this.finP2PContract.redeem(nonce, assetId, finId, '', amount, '', 0, signature);
          break;
        }

        case 'EIP712': {
          const { buyer, settlement } = request.signature.template.message;
          const { asset: settlementAsset, amount: settlementAmount } = settlement.fields;
          txHash = await this.finP2PContract.redeem(nonce, assetId, finId, buyer.fields.finId, amount,
            settlementAsset, settlementAmount, signature);
          break;
        }

        default:
          txHash = '';
          break;
      }

    } catch (e) {
      logger.error(`Error asset redeem: ${e}`);
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
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

