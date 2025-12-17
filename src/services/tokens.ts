import {
  Asset, AssetCreationStatus, Destination, EIP712Template,
  ExecutionContext, ReceiptOperation, Balance, TokenService, Signature, Source,
  failedAssetCreation, failedReceiptOperation, successfulAssetCreation, successfulReceiptOperation,
  pendingReceiptOperation, AssetBind, AssetDenomination, AssetIdentifier, FinIdAccount,
  AssetCreationResult, ValidationError
} from "@owneraio/finp2p-adapter-models";
import { logger, ProofProvider, PluginManager} from "@owneraio/finp2p-nodejs-skeleton-adapter"
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress, ERC20_STANDARD_ID
} from "@owneraio/finp2p-contracts";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { emptyOperationParams, extractBusinessDetails } from "./helpers";
import { validateRequest } from "./validator";
import { keccak256, toUtf8Bytes } from "ethers";


const DefaultDecimals = 2;

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {


  constructor(finP2PContract: FinP2PContract, finP2PClient: FinP2PClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              proofProvider: ProofProvider | undefined,
              pluginManager: PluginManager | undefined) {
    super(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  }

  public async createAsset(idempotencyKey: string, asset: Asset,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { assetId } = asset;
    let tokenStandard = ERC20_STANDARD_ID;
    let tokenAddress: string;
    let allowanceRequired: boolean
    if (assetBind && assetBind.tokenIdentifier) {
      const { tokenIdentifier: { tokenId } } = assetBind;

      if (assetIdentifier) {
        const { type, value } = assetIdentifier;
        if (type === 'CUSTOM') {
          tokenStandard = keccak256(toUtf8Bytes(value));
        }
      }

      if (!isEthereumAddress(tokenId)) {
        return failedAssetCreation(1, `Token ID ${tokenId} is not a valid Ethereum address`);
      }
      tokenAddress = tokenId;
      allowanceRequired = true; // TODO: parse from metadata

      logger.debug(`Associating existing token ${tokenAddress} to asset ${assetId}`);
    } else {

      tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, DefaultDecimals, this.finP2PContract.finP2PContractAddress);
      allowanceRequired = false;
      logger.debug(`Deployed new token ${tokenAddress} for asset ${assetId}`);
    }

    try {
      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress, tokenStandard);
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);
      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

    // TODO: parse assetMetadata to determine token standard and other details

    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const network = `name: ${name}, chainId: ${chainId}`; // public or private network?
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      tokenId: tokenAddress,
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard, // TODO: tokenStandardToService(..)
        additionalContractDetails: {
          finP2POperatorContractAddress,
          allowanceRequired
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const { finId: issuerFinId } = to;
    try {
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, ast: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature: sgn, template } = signature;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, undefined, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      const transactionReceipt  = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
    }
      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptOperation(1, "operationId is required");
    }

    try {
      const transactionReceipt = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt)
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
    return await this.finP2PContract.balance(assetId, finId);
  }

  public async balance(assetId: string, finId: string): Promise<Balance> {
    const balance = await this.finP2PContract.balance(assetId, finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

}

