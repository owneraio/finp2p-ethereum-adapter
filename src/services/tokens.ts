import { CommonService } from './common';
import {
  assetCreationResult,
  extractAssetId,
  getRandomNumber,
  failedAssetCreation,
  failedTransaction,
  redeemParameterFromTemplate, transferParameterFromTemplate
} from "./mapping";
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { RegulationChecker } from '../finp2p/regulation';
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import { isEthereumAddress } from "../../finp2p-contracts/src/contracts/utils";

export type AssetCreationPolicy =
  | { type: 'deploy-new-token'; decimals: number }
  | { type: 'reuse-existing-token'; tokenAddress: string }
  | { type: 'no-deployment' };

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
        const { tokenId: tokenAddress  } = request.ledgerAssetBinding as LedgerTokenId;
        if (!isEthereumAddress(tokenAddress)) {
          return {
            isCompleted: true,
            error: {
              code: 1,
              message: `Token ${tokenAddress} does not exist`,
            },
          } as CreateAssetResponse;
        }

        const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
        await this.finP2PContract.waitForCompletion(txHash);
        return assetCreationResult(tokenAddress, tokenAddress, this.finP2PContract.finP2PContractAddress);


      } else {

        // We do deploy ERC20 here and then associate it with the FinP2P assetId,
        // in a real-world scenario, the token could already deployed in another tokenization application,
        // so we would just associate the assetId with existing token address
        let tokenId, tokenAddress: string;
        switch (this.assetCreationPolicy.type) {
          case 'deploy-new-token':
            const { decimals } = this.assetCreationPolicy;
            tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, decimals,
              this.finP2PContract.finP2PContractAddress);
            tokenId = tokenAddress;
            break;
          case 'reuse-existing-token':
            tokenAddress = this.assetCreationPolicy.tokenAddress;
            tokenId = `${getRandomNumber(10000, 100000)}-${tokenAddress}`;
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
        return assetCreationResult(tokenId, tokenAddress, this.finP2PContract.finP2PContractAddress);
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
    const { asset, quantity, destination } = request;
    const assetId = extractAssetId(asset);
    const issuerFinId = destination.finId;

    if (this.regulation) {
      const error = await this.regulation.doRegulationCheck(destination.finId, assetId);
      if (error) {
        return {
          isCompleted: true,
          error,
        } as Components.Schemas.ReceiptOperation;
      }
    }

    let txHash: string;
    try {
      logger.info(`Issue asset ${assetId} to ${issuerFinId} with amount ${quantity}`);
      txHash = await this.finP2PContract.issue(assetId, issuerFinId, quantity);

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
    const { nonce, asset, quantity, source, destination } = request;
    const assetId = extractAssetId(asset);
    const { finId : sellerFinId } = source;
    const { finId : buyerFinId } = destination;
    const { signature, template } = request.signature;

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
    try {
      const { eip712PrimaryType, hashType, settlementAmount, settlementAsset } = transferParameterFromTemplate(template);
      logger.info(`Transfer asset ${assetId} from ${sellerFinId} to ${buyerFinId} with amount ${quantity} and settlement ${settlementAmount} ${settlementAsset}, hashType: ${template.type}`);

      const txHash = await this.finP2PContract.transfer(nonce, assetId, sellerFinId, buyerFinId, quantity,
        settlementAsset, settlementAmount, hashType, eip712PrimaryType, signature);
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
    const { nonce, asset, quantity, source } = request;
    const assetId = asset.resourceId;
    const { finId : sellerFinId } = source;
    const { signature, template } = request.signature;
    try {
      const { hashType, issuerFinId, settlementAmount, settlementAsset } = redeemParameterFromTemplate(template);
      logger.info(`Redeem asset ${assetId} from ${sellerFinId} with amount ${quantity} and settlement ${settlementAmount} ${settlementAsset}, hashType: ${hashType}`);

      const txHash = await this.finP2PContract.redeem(nonce, assetId, sellerFinId, issuerFinId, quantity, settlementAsset, settlementAmount, hashType, signature);
      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error asset redeem: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

}

