import { CommonService, ExecDetailsStore } from "./common";

import {
  assetTypeFromString,
  EthereumTransactionError,
  term
} from "../../../finp2p-contracts/src/contracts/model";
import { logger } from "../../helpers/logger";
import { FinP2PContract } from "../../../finp2p-contracts/src/contracts/finp2p";
import { isEthereumAddress, truncateDecimals } from "../../../finp2p-contracts/src/contracts/utils";
import { PolicyGetter } from "../../finp2p/policy";
import {
  Asset,
  AssetCreationResult, Destination, EIP712Template,
  ExecutionContext,
  failedAssetCreation, failedReceiptResult, Signature, Source,
  successfulAssetCreation, pendingReceiptResult,
  ReceiptResult, Balance
} from "../model";
import { TokenService } from "../interfaces";
import { getRandomNumber } from "../utils";
import { extractEIP712Params } from "../mapping";
import { AssetCreationPolicy } from "./model";



export class TokenServiceImpl extends CommonService implements TokenService {

  assetCreationPolicy: AssetCreationPolicy;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy, policyGetter: PolicyGetter | undefined,
              execDetailsStore: ExecDetailsStore | undefined, defaultDecimals: number = 18) {
    super(finP2PContract, policyGetter, execDetailsStore, defaultDecimals);
    this.assetCreationPolicy = assetCreationPolicy;
  }

  public async createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationResult> {
    try {

      if (tokenId) {
        if (!isEthereumAddress(tokenId)) {
          return failedAssetCreation(1, `Token ID ${tokenId} is not a valid Ethereum address`);
        }

        const txHash = await this.finP2PContract.associateAsset(assetId, tokenId);
        await this.finP2PContract.waitForCompletion(txHash);
        return successfulAssetCreation(tokenId, tokenId, this.finP2PContract.finP2PContractAddress);

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
            return failedAssetCreation(1, "Creation of new assets is not allowed by the policy");
        }

        const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
        await this.finP2PContract.waitForCompletion(txHash);
        return successfulAssetCreation(tokenId, tokenAddress, this.finP2PContract.finP2PContractAddress);
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

  public async issue(asset: Asset, issuerFinId: string, quantity: string, executionContext: ExecutionContext): Promise<ReceiptResult> {
    let txHash: string;
    try {
      logger.info(`Issue asset ${asset.assetId} to ${issuerFinId} with amount ${quantity}`);
      txHash = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity));
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);

      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }
    return pendingReceiptResult(txHash);
  }


  public async transfer(nonce: string, source: Source, destination: Destination, ast: Asset,
                        quantity: string, signature: Signature, executionContext: ExecutionContext
  ): Promise<ReceiptResult> {
    const { signature: sgn, template } = signature;
    try {
      const eip712Template = template as EIP712Template;
      const eip712Params = extractEIP712Params(ast, source, destination, undefined, eip712Template, executionContext);
      this.validateRequest(source, destination, quantity, eip712Params);
      const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;

      const txHash = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }
      return pendingReceiptResult(txHash);
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);

      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }

  }

  // public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
  public async redeem(source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string,
                       executionContext: ExecutionContext
  ): Promise<ReceiptResult> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptResult(1, "operationId is required");
    }

    try {
      const txHash = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity);
      if (executionContext) {
        this.execDetailsStore?.addExecutionContext(txHash, executionContext.planId, executionContext.sequence);
      }
      return pendingReceiptResult(txHash);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptResult(1, e.message);
      } else {
        return failedReceiptResult(1, `${e}`);
      }
    }
  }

  public async getBalance(assetId: string, finId: string): Promise<string> {
    const balance = await this.finP2PContract.balance(assetId, finId);
    return truncateDecimals(balance, this.defaultDecimals);
  }

  public async balance(assetId: string, finId: string): Promise<Balance> {
    const balance = await this.finP2PContract.balance(assetId, finId);
    const truncated = truncateDecimals(balance, this.defaultDecimals);
    return {
      current: truncated,
      available: truncated,
      held: truncated
    }
  }

}

