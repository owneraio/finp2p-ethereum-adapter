import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation, successfulReceiptOperation, pendingReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  ReceiptOperation, Source, Signature, logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { ValidationError } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress
} from "@owneraio/finp2p-contracts";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { mapReceiptOperation } from "./mapping";
import { emptyOperationParams, extractBusinessDetails } from "./helpers";
import { validateRequest } from "./validator";


const DefaultDecimals = 2;

/**
 * 0.28.2+ FINP2POperator extracts the ERC20 contract address from the trailing
 * ":0x<40-hex>" of each assetId. EIP712-signed flows carry the CAIP-style id
 * natively (e.g. "name: sepolia, chainId: .../ERC20:0x..."); for unsigned
 * paths (`issue`, balance reads), the adapter appends the standard + tokenId
 * suffix from the asset's ledgerIdentifier so the contract can route.
 */
const toContractAssetId = (asset: Asset): string => {
  // Already CAIP-encoded with a token-address suffix — pass through.
  if (/:0x[a-fA-F0-9]{40}$/.test(asset.assetId)) return asset.assetId;
  const li = asset.ledgerIdentifier;
  if (!li?.tokenId) return asset.assetId;
  return `${asset.assetId}/${li.standard ?? 'ERC20'}:${li.tokenId}`;
};

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {


  constructor(finP2PContract: FinP2PContract, finP2PClient: FinP2PClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              proofProvider: ProofProvider | undefined,
              pluginManager: PluginManager | undefined) {
    super(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  }

  public async createAsset(idempotencyKey: string, assetId: string,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    let tokenAddress: string;
    let allowanceRequired: boolean;
    const operatorAddress = this.finP2PContract.finP2PContractAddress;
    if (assetBind?.tokenIdentifier?.tokenId && isEthereumAddress(assetBind.tokenIdentifier.tokenId)) {
      tokenAddress = assetBind.tokenIdentifier.tokenId;
      allowanceRequired = true; // TODO: parse from metadata
      logger.info(`createAsset(${assetId}): binding to existing ERC20 at ${tokenAddress}`);
    } else {
      logger.info(`createAsset(${assetId}): deploying new ERC20 (decimals=${DefaultDecimals}, operator=${operatorAddress})`);
      try {
        tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, DefaultDecimals, operatorAddress);
      } catch (e) {
        logger.error(`createAsset(${assetId}): deployERC20 failed: ${e}`);
        if (e instanceof EthereumTransactionError) return failedAssetCreation(1, e.message);
        return failedAssetCreation(1, `${e}`);
      }
      allowanceRequired = false;
      logger.info(`createAsset(${assetId}): deployed ERC20 at ${tokenAddress}`);
    }
    // 0.28.2: no on-chain assetId→tokenAddress association. The tokenAddress is
    // expected to be carried inline in every EIP712 Term assetId the platform
    // signs (e.g. "name: <net>, chainId: <id>/ERC20:<tokenAddress>").

    // TODO: parse assetMetadata to determine token standard and other details

    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const network = `name: ${name}, chainId: ${chainId}`; // public or private network?
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network, tokenId: tokenAddress, standard: 'ERC20' },
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

  public async issue(idempotencyKey: string, asset: Asset, destinationFinId: string, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const issuerFinId = destinationFinId;
    try {
      await this.ensureCredential(issuerFinId);
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(toContractAssetId(asset), assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset)
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
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt  = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
    }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast)
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(idempotencyKey: string, nonce: string, sourceFinId: string, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptOperation(1, "operationId is required");
    }

    try {
      await this.ensureCredential(sourceFinId);
      const transactionReceipt = await this.finP2PContract.releaseAndRedeem(operationId, sourceFinId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset)
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
    return await this.finP2PContract.balance(toContractAssetId(asset), finId);
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    await this.ensureCredential(finId);
    const balance = await this.finP2PContract.balance(toContractAssetId(asset), finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

}

