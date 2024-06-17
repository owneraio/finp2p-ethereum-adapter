import { CommonService } from './common';
import { extractAssetId } from './mapping';
const { ethers } = require('ethers');

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
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
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
    if (request.asset.type !== 'finp2p') {
      throw new Error(`Unsupported asset type: ${request.asset.type}`);
    }
    const nonce = request.nonce;
    const operationId = request.operationId;
    const assetId = request.asset.resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;
    const safeOpId = operationId ?? manualHexZeroPad('0x0', 16);
    const txHash = await this.finP2PContract.redeem(safeOpId, nonce, assetId, finId, amount, settlementHash, hash, signature);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

function manualHexZeroPad(hexString: string, lengthInBytes: number): string {
  const targetLength = lengthInBytes * 2;  // Each byte consists of two hexadecimal characters
  const hexStripped = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
  const paddingNeeded = targetLength - hexStripped.length;

  if (paddingNeeded > 0) {
      // Pad with zeros at the beginning of the string
      return '0x' + '0'.repeat(paddingNeeded) + hexStripped;
  } else {
      // No padding needed, return original string with '0x'
      return '0x' + hexStripped;
  }
}