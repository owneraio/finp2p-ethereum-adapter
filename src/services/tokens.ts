import {
  logger,
  Asset, AssetCreationStatus, Destination, EIP712Template,
  ExecutionContext, ReceiptOperation, Balance, PolicyGetter, TokenService, Signature, Source,
  failedAssetCreation, failedReceiptOperation, successfulAssetCreation,
  pendingReceiptOperation, getRandomNumber
} from "@owneraio/finp2p-nodejs-skeleton-adapter";

import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress, truncateDecimals
} from "../../finp2p-contracts/src/contracts";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { extractEIP712Params } from "./helpers";
import { AssetCreationPolicy } from "./model";


export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  assetCreationPolicy: AssetCreationPolicy;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy, policyGetter: PolicyGetter | undefined,
              execDetailsStore: ExecDetailsStore | undefined, defaultDecimals: number = 18) {
    super(finP2PContract, policyGetter, execDetailsStore, defaultDecimals);
    this.assetCreationPolicy = assetCreationPolicy;
  }

  public async createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationStatus> {
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

  public async issue(asset: Asset, issuerFinId: string, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    let txHash: string;
    try {
      logger.info(`Issue asset ${asset.assetId} to ${issuerFinId} with amount ${quantity}`);
      txHash = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity));
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    return pendingReceiptOperation(txHash);
  }


  public async transfer(nonce: string, source: Source, destination: Destination, ast: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature: sgn, template } = signature;
    try {
      const eip712Template = template as EIP712Template;
      const eip712Params = extractEIP712Params(ast, source, destination, undefined, eip712Template, exCtx);
      this.validateRequest(source, destination, quantity, eip712Params);
      const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;

      const txHash = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }
      return pendingReceiptOperation(txHash);
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
                      signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptOperation(1, "operationId is required");
    }

    try {
      const txHash = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
      }
      return pendingReceiptOperation(txHash);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
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
    };
  }

}

