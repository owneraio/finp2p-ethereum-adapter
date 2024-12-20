import { CommonService } from './common';
import { assetCreationResult, extractAssetId, getRandomNumber } from "./mapping";
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { RegulationChecker } from '../finp2p/regulation';
import HashListTemplate = Components.Schemas.HashListTemplate;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import { isEthereumAddress } from "../../finp2p-contracts/src/contracts/utils";

export type DeployNewToken = {
  type: 'deploy-new-token';
};
export type ReuseExistingToken = {
  type: 'reuse-existing-token';
  tokenAddress: string;
};
export type AssetCreationPolicy = DeployNewToken | ReuseExistingToken;

export class TokenService extends CommonService {

  assetCreationPolicy: AssetCreationPolicy;

  regulation: RegulationChecker | undefined;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy, regulation: RegulationChecker | undefined) {
    super(finP2PContract);
    this.assetCreationPolicy = assetCreationPolicy;
    this.regulation = regulation;
  }

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    try {

      if (request.ledgerAssetBinding) {
        const { tokenId } = request.ledgerAssetBinding as LedgerTokenId;
        if (!isEthereumAddress(tokenId)) {
          return {
            isCompleted: true,
            error: {
              code: 1,
              message: `Token ${tokenId} does not exist`,
            },
          } as CreateAssetResponse;
        }
        const tokenAddress = tokenId;
        const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
        await this.finP2PContract.waitForCompletion(txHash);

        return assetCreationResult(txHash, tokenId, tokenAddress, this.finP2PContract.finP2PContractAddress);

      } else {

        // We do deploy ERC20 here and then associate it with the FinP2P assetId,
        // in a real-world scenario, the token could already deployed in another tokenization application,
        // so we would just associate the assetId with existing token address
        let tokenId, tokenAddress: string;
        switch (this.assetCreationPolicy.type) {
          case 'deploy-new-token':
            tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
              this.finP2PContract.finP2PContractAddress);
            tokenId = tokenAddress;
            break;
          case 'reuse-existing-token':
            tokenAddress = this.assetCreationPolicy.tokenAddress;
            tokenId = `${getRandomNumber(10000, 100000)}-${tokenAddress}`;
            break;
        }

        const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
        await this.finP2PContract.waitForCompletion(txHash);
        return assetCreationResult(txHash, tokenId, tokenAddress, this.finP2PContract.finP2PContractAddress);
      }

    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e.message,
          },
        } as CreateAssetResponse;
      } else {
        return {
          isCompleted: true,
          error: {
            code: 1,
            message: e,
          },
        } as Components.Schemas.CreateAssetResponse;
      }
    }

  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    if (this.regulation) {
      const error = await this.regulation.doRegulationCheck(issuerFinId, assetId);
      if (error) {
        return {
          isCompleted: true,
          error,
        } as Components.Schemas.ReceiptOperation;
      }
    }
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
            message: `${e}`,
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
    const hashList = request.signature.template as HashListTemplate
    if (hashList.hashGroups.length > 1) {
      settlementHash = hashList.hashGroups[1].hash;
    }
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    if (this.regulation) {
      const error = await this.regulation.doRegulationCheck(destinationFinId, assetId);
      if (error) {
        return {
          isCompleted: true,
          error,
        } as Components.Schemas.ReceiptOperation;
      }
    }

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
            message: `${e}`,
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
    const hashList = request.signature.template as HashListTemplate
    const settlementHash = hashList.hashGroups[1].hash;
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
            message: `${e}`,
          },
        } as Components.Schemas.ReceiptOperation;
      }
    }
  }

}

