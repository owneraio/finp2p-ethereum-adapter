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
    let buyerFinId = '';
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    let nonce: string = request.nonce;
    const signature = request.signature.signature;

    let settlementHash: string = '';

    switch (request.signature.template.type) {
      case 'hashList':
        if (request.signature.template.hashGroups.length > 1) {
          settlementHash = request.signature.template.hashGroups[1].hash;
        }
        // TODO: extract from signature template
        break;
      case 'EIP712':
        const { domain, types, primaryType, message } = request.signature.template;
        console.log('EIP712 payload');
        console.log('\tdomain: ', domain);
        console.log('\ttypes: ', types);
        console.log('\tprimaryType: ', primaryType);
        console.log('\tmessage: ', message);
        // console.log('\thash: ', request.signature.template.hash);

        if (domain === undefined || types === undefined || primaryType === undefined || message === undefined) {
          throw new Error('Invalid EIP712 signature template');
        }
        const { chainId, verifyingContract } = domain;
        if (chainId === undefined || verifyingContract === undefined) {
          throw new Error('Invalid EIP712 domain');
        }

        const { buyer, settlement } = message;
        buyerFinId = buyer.fields.key;
        settlementHash = termHash(settlement.fields.assetId, settlement.fields.assetType, settlement.fields.amount);

        try {
          const { nonce: b64Nonce } = message;
          nonce = Buffer.from(b64Nonce.toString(), 'base64').toString('hex');
          const eip721message = {
            nonce: `0x${nonce}`,
            buyer: { ... message.buyer.fields },
            issuer: { ... message.issuer.fields },
            asset: { ... message.asset.fields },
            settlement: { ... message.settlement.fields },
          } as EIP721IssuanceMessage;
          const hash = hashEIP721Issuance(chainId, verifyingContract, eip721message);
          console.log('\thash: ', hash);
          const signerAddress = publicKeyToAddress(buyerFinId);
          console.log('\tsignerAddress: ', signerAddress);
          const verified = verifyEIP721Issuance(chainId, verifyingContract, eip721message, signerAddress, signature);
          console.log('\tverified: ', verified);
        } catch (e) {
          console.error(e);
        }


        break;
    }


    const txHash = await this.finP2PContract.issue(nonce, assetId, buyerFinId, issuerFinId, amount, settlementHash, signature);

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

