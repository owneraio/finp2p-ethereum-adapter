import { CommonService } from './common';
import { extractAssetId } from './mapping';
import {
  EIP721IssuanceMessage,
  hashEIP721Issuance,
  termHash,
  verifyEIP721Issuance,
} from '../../finp2p-contracts/test/utils';
import console from 'console';

export class TokenService extends CommonService {

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    const assetId = extractAssetId(request.asset);

    // We do deploy ERC20 here and then associate it with the FinP2P assetId,
    // in a real-world scenario, the token could already deployed in another tokenization application,
    // so we would just associate the assetId with existing token address

    const tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
      this.finP2PContract.finP2PContractAddress);

    const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const amount = parseInt(request.quantity);

    switch (request.signature.template.type) {
      case 'hashList': {
        const txHash = await this.finP2PContract.issueWithoutSignature(assetId, request.destination.finId, amount);
        return {
          isCompleted: false,
          cid: txHash,
        } as Components.Schemas.ReceiptOperation;
      }

      case 'EIP712': {
        const { nonce, issuer, buyer, settlement } = request.signature.template.message;
        const nonceDec = Buffer.from(nonce.toString(), 'base64').toString('hex');
        const buyerFinId = buyer.fields.key; // should be equal to request.destination.finId
        const issuerFinId = issuer.fields.key;
        const signature = request.signature.signature;
        const settlementHash = termHash(settlement.fields.assetId, settlement.fields.assetType, settlement.fields.amount);
        const txHash = await this.finP2PContract.issue(nonceDec, assetId, buyerFinId, issuerFinId, amount, settlementHash, signature);
        return {
          isCompleted: false,
          cid: txHash,
        } as Components.Schemas.ReceiptOperation;
      }
    }

  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    if (request.asset.type !== 'finp2p') {
      throw new Error(`Unsupported asset type: ${request.asset.type}`);
    }
    const nonce = request.nonce;
    const assetId = request.asset.resourceId;
    const sourceFinId = request.source.finId;
    const destinationFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    let settlementHash: string = '';
    switch (request.signature.template.type) {
      case 'hashList':
        if (request.signature.template.hashGroups.length > 1) {
          settlementHash = request.signature.template.hashGroups[1].hash;
        }
        break;
      case 'EIP712':
        break;
    }

    const signature = request.signature.signature;

    try {
      const txHash = await this.finP2PContract.transfer(nonce, assetId, sourceFinId, destinationFinId, amount, settlementHash, signature);

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
    if (request.asset.type !== 'finp2p') {
      throw new Error(`Unsupported asset type: ${request.asset.type}`);
    }
    const nonce = request.nonce;
    const assetId = request.asset.resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    let settlementHash: string = '';
    switch (request.signature.template.type) {
      case 'hashList':
        if (request.signature.template.hashGroups.length > 1) {
          settlementHash = request.signature.template.hashGroups[1].hash;
        }
        break;
      case 'EIP712':
        break;
    }
    const signature = request.signature.signature;

    const txHash = await this.finP2PContract.redeem(nonce, assetId, finId, amount, settlementHash, signature);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

