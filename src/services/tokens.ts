import {
  logger,
  Asset, AssetCreationStatus, Destination, EIP712Template,
  ExecutionContext, ReceiptOperation, Balance, TokenService, Signature, Source,
  failedAssetCreation, failedReceiptOperation, successfulAssetCreation,
  pendingReceiptOperation, AssetBind, AssetDenomination, AssetIdentifier, FinIdAccount,
  AssetCreationResult
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress, truncateDecimals
} from "../../finp2p-contracts/src";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { extractEIP712Params } from "./helpers";
import { AssetCreationPolicy } from "./model";
import { validateRequest } from "./validator";


export class TokenServiceImpl extends CommonServiceImpl implements TokenService {

  assetCreationPolicy: AssetCreationPolicy;

  constructor(finP2PContract: FinP2PContract, assetCreationPolicy: AssetCreationPolicy, finP2PClient: FinP2PClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined, defaultDecimals: number = 18) {
    super(finP2PContract, finP2PClient, execDetailsStore, defaultDecimals);
    this.assetCreationPolicy = assetCreationPolicy;
  }

  public async createAsset(idempotencyKey: string, asset: Asset,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { assetId } = asset;
    let tokenAddress: string;
    if (assetBind && assetBind.tokenIdentifier) {
      const { tokenIdentifier: { tokenId } } = assetBind;
      if (!isEthereumAddress(tokenId)) {
        return failedAssetCreation(1, `Token ID ${tokenId} is not a valid Ethereum address`);
      }
      tokenAddress = tokenId;
    } else {

      // todo: extract reuse-existing-token to a plugin
      // We do deploy ERC20 here and then associate it with the FinP2P assetId,
      // in a real-world scenario, the token could already deployed in another tokenization application,
      // so we would just associate the assetId with existing token address
      switch (this.assetCreationPolicy.type) {
        case "deploy-new-token":
          const { decimals } = this.assetCreationPolicy;
          tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, decimals, this.finP2PContract.finP2PContractAddress);
          break;
        case "reuse-existing-token":
          tokenAddress = this.assetCreationPolicy.tokenAddress;
          // tokenId = `${getRandomNumber(10000, 100000)}-${tokenAddress}`;
          break;
        case "no-deployment":
          return failedAssetCreation(1, "Creation of new assets is not allowed by the policy");
      }
    }

    try {
      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
      // TODO: translate to pending operation
      await this.finP2PContract.waitForCompletion(txHash);
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);

      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

    const tokenStandard = "ERC20-with-operator";
    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const network = `name: ${name}, chainId: ${chainId}`;
    const result: AssetCreationResult = {
      tokenId: tokenAddress,
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard,
        additionalContractDetails: {
          finP2POperatorContractAddress: this.finP2PContract.finP2PContractAddress,
          allowanceRequired: false
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const { finId: issuerFinId } = to;
    let txHash: string;
    logger.info(`Issue asset ${asset.assetId} to ${issuerFinId} with amount ${quantity}`);
    try {
      txHash = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity));
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }
    return pendingReceiptOperation(txHash, undefined);
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, ast: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature: sgn, template } = signature;
    if (template.type != "EIP712") {
      throw new Error(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const eip712Params = extractEIP712Params(ast, source, destination, undefined, eip712Template, exCtx);
    validateRequest(source, destination, quantity, eip712Params);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = eip712Params;

    let txHash: string;
    try {
      txHash = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }
    return pendingReceiptOperation(txHash, undefined);
  }

  public async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined,
                      signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptOperation(1, "operationId is required");
    }

    let txHash: string;
    try {
      txHash = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity);
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(txHash, exCtx.planId, exCtx.sequence);
    }
    return pendingReceiptOperation(txHash, undefined);

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

