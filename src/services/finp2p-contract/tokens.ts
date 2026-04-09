import {
  Asset, AssetBase, AssetCreationStatus, EIP712Template, Balance, TokenService,
  failedAssetCreation, successfulAssetCreation,
  AssetBind, AssetDenomination,
  AssetCreationResult, Signature, Destination, ExecutionContext,
  ReceiptOperation, Source, FinIdAccount,
  logger, ProofProvider, PluginManager,
  failedReceiptOperation,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  ValidationError
} from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress
} from "@owneraio/finp2p-contracts";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { emptyOperationParams, extractBusinessDetails } from "./helpers";
import { validateRequest } from "./validator";


const DefaultDecimals = 2;

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {


  constructor(finP2PContract: FinP2PContract, finP2PClient: FinP2PClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              proofProvider: ProofProvider | undefined,
              pluginManager: PluginManager | undefined) {
    super(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  }

  public async createAsset(idempotencyKey: string, asset: AssetBase,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    const { assetId } = asset;
    let tokenAddress: string;
    let allowanceRequired: boolean
    if (assetBind && assetBind.tokenIdentifier) {
      const { tokenIdentifier: { tokenId } } = assetBind;

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
      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress);
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);
      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

    // TODO: parse assetMetadata to determine token standard and other details

    const { chainId } = await this.finP2PContract.provider.getNetwork();
    // TODO: use proper CAIP-19 network: `eip155:${chainId}`
    const network = 'ethereum';
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      ledgerIdentifier: { network, tokenId: tokenAddress, standard: "ERC20" },
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard: "ERC20",
        additionalContractDetails: {
          finP2POperatorContractAddress,
          allowanceRequired
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, to: Destination, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const issuerFinId = to.finId;
    try {
      await this.ensureCredential(issuerFinId);
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt) as unknown as ReceiptOperation // TODO: remove cast after updating finp2p-contracts Asset type to include ledgerIdentifier
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async doesSupportCrosschainTransfer(_sourceAsset: Asset, _destinationAsset: Asset): Promise<boolean> {
    return false;
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination,
                        sourceAsset: Asset, destinationAsset: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const ast = sourceAsset;
    const { signature: sgn, template } = signature;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, undefined, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt  = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
    }
      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt) as unknown as ReceiptOperation // TODO: remove cast after updating finp2p-contracts Asset type to include ledgerIdentifier
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
      await this.ensureCredential(source.finId);
      const transactionReceipt = await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt) as unknown as ReceiptOperation // TODO: remove cast after updating finp2p-contracts Asset type to include ledgerIdentifier
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  public async getBalance(asset: Asset, finId: string): Promise<string> {
    await this.ensureCredential(finId);
    return await this.finP2PContract.balance(asset.assetId, finId);
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    await this.ensureCredential(finId);
    const balance = await this.finP2PContract.balance(asset.assetId, finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

}

