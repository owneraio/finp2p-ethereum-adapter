import { CommonService } from "./common";
import {
  assetCreationResult,
  assetFromAPI,
  extractEIP712Params,
  failedAssetCreation,
  failedTransaction,
  getRandomNumber, RequestValidationError
} from "./mapping";
import { assetTypeFromString, EthereumTransactionError, term } from "../../finp2p-contracts/src/contracts/model";
import { logger } from "../helpers/logger";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { isEthereumAddress } from "../../finp2p-contracts/src/contracts/utils";
import { PolicyGetter } from "../finp2p/policy";
import CreateAssetResponse = Components.Schemas.CreateAssetResponse;
import LedgerTokenId = Components.Schemas.LedgerTokenId;

export type AssetCreationPolicy = | { type: "deploy-new-token"; decimals: number } | {
  type: "reuse-existing-token";
  tokenAddress: string
} | { type: "no-deployment" };

export class TokenService extends CommonService {

  assetCreationPolicy: AssetCreationPolicy;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy, policyGetter: PolicyGetter | undefined) {
    super(finP2PContract, policyGetter);
    this.assetCreationPolicy = assetCreationPolicy;
  }

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    const { assetId } = assetFromAPI(request.asset);
    try {

      if (request.ledgerAssetBinding) {
        const { tokenId: tokenAddress } = request.ledgerAssetBinding as LedgerTokenId;
        if (!isEthereumAddress(tokenAddress)) {
          return {
            isCompleted: true, error: {
              code: 1, message: `Token ${tokenAddress} does not exist`
            }
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
          case "deploy-new-token":
            const { decimals } = this.assetCreationPolicy;
            tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, decimals, this.finP2PContract.finP2PContractAddress);
            tokenId = tokenAddress;
            break;
          case "reuse-existing-token":
            tokenAddress = this.assetCreationPolicy.tokenAddress;
            tokenId = `${getRandomNumber(10000, 100000)}-${tokenAddress}`;
            break;
          case "no-deployment":
            return {
              isCompleted: true, error: {
                code: 1, message: "Creation of new assets is not allowed by the policy"
              }
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
    const { asset, quantity, destination: { finId: issuerFinId } } = request;
    const { assetId, assetType } = assetFromAPI(asset);

    let txHash: string;
    try {
      logger.info(`Issue asset ${assetId} to ${issuerFinId} with amount ${quantity}`);
      txHash = await this.finP2PContract.issue(issuerFinId, term(assetId, assetTypeFromString(assetType), quantity));
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
    return {
      isCompleted: false, cid: txHash
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const eip712Params = extractEIP712Params(request);
    try {
      this.validateRequest(request, eip712Params);
    } catch (e) {
      if (e instanceof RequestValidationError) {
        logger.error(`Validation error: ${e.reason}`);
        return failedTransaction(1, e.reason);
      }
    }
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;
    const { nonce, signature: { signature } } = request;

    try {
      const txHash = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, signature);
      return {
        isCompleted: false, cid: txHash
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


}

