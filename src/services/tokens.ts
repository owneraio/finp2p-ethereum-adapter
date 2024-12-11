import { CommonService } from './common';
import {
  assetCreationResult,
  extractAssetId,
  failedAssetCreation,
  failedTransaction,
  issueParameterFromTemplate, redeemParameterFromTemplate, transferParameterFromTemplate
} from "./mapping";
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { RegulationChecker } from '../finp2p/regulation';
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import { isEthereumAddress } from "../../finp2p-contracts/src/contracts/utils";

export type DeploymentType =  'deploy-new-token' | 'reuse-existing-token' | 'no-deployment';

export type DeployNewToken = {
  type: 'deploy-new-token';
};

export type ReuseExistingToken = {
  type: 'reuse-existing-token';
  tokenAddress: string;
};

export type NoDeployment = {
  type: 'no-deployment';
};

export type AssetCreationPolicy = DeployNewToken | ReuseExistingToken | NoDeployment;

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
        const { tokenId  } = request.ledgerAssetBinding as LedgerTokenId;
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

        return assetCreationResult(txHash, tokenAddress, tokenAddress, this.finP2PContract.finP2PContractAddress);

      } else {

        // We do deploy ERC20 here and then associate it with the FinP2P assetId,
        // in a real-world scenario, the token could already deployed in another tokenization application,
        // so we would just associate the assetId with existing token address
        let tokenAddress: string;
        switch (this.assetCreationPolicy.type) {
          case 'deploy-new-token':
            tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId,
              this.finP2PContract.finP2PContractAddress);
            break;
          case 'reuse-existing-token':
            tokenAddress = this.assetCreationPolicy.tokenAddress;
            break;
          case 'no-deployment':
            return {
              isCompleted: true,
              error: {
                code: 1,
                message: 'Creation of new assets is not allowed by the policy',
              },
            } as CreateAssetResponse;
        }

        const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
        await this.finP2PContract.waitForCompletion(txHash);
        return assetCreationResult(txHash, tokenAddress, tokenAddress, this.finP2PContract.finP2PContractAddress);
      }

    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);

      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const assetId = extractAssetId(request.asset);
    const amount = parseInt(request.quantity);
    const issuerFinId = request.destination.finId;

    if (this.regulation) {
      const error = await this.regulation.doRegulationCheck(request.destination.finId, assetId);
      if (error) {
        return {
          isCompleted: true,
          error,
        } as Components.Schemas.ReceiptOperation;
      }
    }

    let txHash: string;
    try {
      if (!request.signature || !request.signature.template) {
        txHash = await this.finP2PContract.issueWithoutSignature(assetId, issuerFinId, amount);
      } else {
        const { nonce } = request;
        const { signature, template } = request.signature;
        const { hashType, buyerFinId, settlementAmount, settlementAsset } = issueParameterFromTemplate(template);

        txHash = await this.finP2PContract.issue(nonce, assetId, buyerFinId, issuerFinId, amount,
          settlementAsset, settlementAmount, hashType, signature);
      }
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
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
    const amount = parseInt(request.quantity);
    const sellerFinId = request.source.finId;
    const buyerFinId = request.destination.finId;

    if (this.regulation) {
      const buyerFinId = request.destination.finId;
      const error = await this.regulation.doRegulationCheck(buyerFinId, assetId);
      if (error) {
        return {
          isCompleted: true,
          error,
        } as Components.Schemas.ReceiptOperation;
      }
    }
    const { signature, template } = request.signature;
    try {
      const { hashType, settlementAmount, settlementAsset } = transferParameterFromTemplate(template);
      const txHash = await this.finP2PContract.transfer(nonce, assetId, sellerFinId, buyerFinId, amount,
        settlementAsset, settlementAmount, hashType, signature);
      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }

  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const nonce = request.nonce;
    const assetId = request.asset.resourceId;
    const amount = parseInt(request.quantity);
    const ownerFinId = request.source.finId;

    const { signature, template } = request.signature;
    let txHash = '';
    try {
      const { hashType, buyerFinId, settlementAmount, settlementAsset } = redeemParameterFromTemplate(template);
      txHash = await this.finP2PContract.redeem(nonce, assetId, ownerFinId, buyerFinId, amount,
        settlementAsset, settlementAmount, hashType, signature);

    } catch (e) {
      logger.error(`Error asset redeem: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

