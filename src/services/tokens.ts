import { CommonService } from './common';
import {
  assetCreationResult,
  extractAssetId,
  getRandomNumber,
  failedAssetCreation,
  failedTransaction,
  extractParameterFromSignatureTemplate
} from "./mapping";
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { RegulationChecker } from '../finp2p/regulation';
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;
import { isEthereumAddress } from "../../finp2p-contracts/src/contracts/utils";
import { EIP712PrimaryType } from "../../finp2p-contracts/src/contracts/eip712";

export type AssetCreationPolicy =
  | { type: 'deploy-new-token'; decimals: number }
  | { type: 'reuse-existing-token'; tokenAddress: string }
  | { type: 'no-deployment' };

export class TokenService extends CommonService {

  assetCreationPolicy: AssetCreationPolicy;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy) {
    super(finP2PContract);
    this.assetCreationPolicy = assetCreationPolicy;
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
    const { signature, template } = request.signature;

    try {
      const { eip712PrimaryType, hashType, buyerFinId, sellerFinId, assetId, assetAmount, settlementAmount, settlementAsset } = extractParameterFromSignatureTemplate(template);
      if (buyerFinId !== destination.finId) {
        return failedTransaction(1, `Buyer FinId in the signature does not match the destination FinId`);
      }
      if (sellerFinId !== source.finId) {
        return failedTransaction(1, `Seller FinId in the signature does not match the source FinId`);
      }

      let txHash: string
      switch (eip712PrimaryType) {
        case EIP712PrimaryType.Buying:
        case EIP712PrimaryType.Selling:
        case EIP712PrimaryType.PrivateOffer:
          if (asset.type !== 'finp2p') {
            return failedTransaction(1, 'Asset transfer is only supported for finp2p assets');
          }
          if (asset.resourceId !== assetId) {
            return failedTransaction(1, `Requested asset id for finp2p asset does not match the asset id in the template`);
          }
          if (assetAmount !== quantity) {
            return failedTransaction(1, `Requested asset amount for finp2p asset does not match the asset amount in the template`);
          }
          if (source.finId !== sellerFinId) {
            return failedTransaction(1, `Requested seller finId does not match the buyer finId in the template`);
          }
          if (destination.finId !== buyerFinId) {
            return failedTransaction(1, `Requested buyer finId does not match the seller finId in the template`);
          }

          logger.info(`Transfer asset ${assetId} from ${sellerFinId} to ${buyerFinId} with amount ${quantity} and settlement ${settlementAmount} ${settlementAsset}, hashType: ${template.type}`);

          txHash = await this.finP2PContract.transfer(nonce, assetId, sellerFinId, buyerFinId, quantity,
            settlementAsset, settlementAmount, hashType, eip712PrimaryType, signature);
          break

        case EIP712PrimaryType.Redemption:
        case EIP712PrimaryType.Loan:
          if (asset.type !== 'fiat' && asset.type !== 'cryptocurrency') {
            return failedTransaction(1, 'Payment transfer is only supported for fiat and cryptocurrency assets');
          }
          if (asset.code !== settlementAsset) {
            return failedTransaction(1, `Requested settlement asset code does not match the settlement asset code in the template`);
          }
          if (settlementAmount !== quantity) {
            return failedTransaction(1, `Requested settlement amount does not match the settlement amount in the template`);
          }
          if (source.finId !== buyerFinId) {
            return failedTransaction(1, `Requested buyer finId does not match the buyer finId in the template`);
          }
          if (destination.finId !== sellerFinId) {
            return failedTransaction(1, `Requested seller finId does not match the seller finId in the template`);
          }
          logger.info(`Transfer asset ${assetId} from ${buyerFinId} to ${sellerFinId} with amount ${quantity} and settlement ${settlementAmount} ${settlementAsset}, hashType: ${template.type}`);

          txHash = await this.finP2PContract.transfer(nonce, assetId, buyerFinId, sellerFinId, quantity,
            settlementAsset, settlementAmount, hashType, eip712PrimaryType, signature);
          break

        default:
          return failedTransaction(1, `Unsupported primary type: ${eip712PrimaryType}`);
      }



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
    const { operationId, source, quantity} = request;
    if (!operationId) {
      return failedTransaction(1, 'operationId is required');
    }

    try {
      const txHash = await this.finP2PContract.release(operationId, source.finId, quantity);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    }  catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);
      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

}

