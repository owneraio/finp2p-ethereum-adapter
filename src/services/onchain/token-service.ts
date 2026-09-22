import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService, EscrowService,
  CommonService, HealthService, OperationStatus,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  ReceiptOperation, Source, Signature, logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { keccak256, parseUnits, toUtf8Bytes } from "ethers";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  ValidationError,
  term, isEthereumAddress
} from "@owneraio/finp2p-ethereum-orchestrator";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { AssetRecord, Logger as PluginLogger, TokenStandard, TokenWallet } from "@owneraio/finp2p-ethereum-adapter-contract";
import { TokenStandardName as COLLATERAL_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-collateral";

import { tokenStandardRegistry } from "../../integrations/token-standards/registry";
import { buildOperationContext, deriveReleaseType, resultToReceipt } from "../operations";
import { ExecDetailsStore } from "./exec-details-store";
import { mapReceiptOperation } from "./mapping";
import { emptyOperationParams, extractBusinessDetails, validateRequest } from "./helpers";

const DefaultDecimals = 2;

// the skeleton logger spells the warn level `warning`; adapt to the plugin Logger shape
const pluginLogger: PluginLogger = {
  debug: (m, ...a) => logger.debug(m, ...a),
  info: (m, ...a) => logger.info(m, ...a),
  warn: (m, ...a) => logger.warning(m, ...a),
  error: (m, ...a) => logger.error(m, ...a),
};

/**
 * On-chain (FINP2POperator contract) token, escrow and common operations —
 * every instruction executes as a transaction against the operator contract,
 * which verifies investor EIP-712 intents on-chain.
 */
export class OnChainTokenService implements TokenService, EscrowService, CommonService, HealthService {

  private readonly registeredCredentials = new Set<string>();

  constructor(
    readonly finP2PContract: FinP2PContract,
    readonly finP2PClient: FinP2PClient | undefined,
    readonly execDetailsStore: ExecDetailsStore | undefined,
    readonly proofProvider: ProofProvider | undefined,
    readonly pluginManager: PluginManager | undefined,
    readonly defaultAssetStandard: string | undefined = undefined,
  ) {}

  private async ensureCredential(finId: string): Promise<void> {
    if (this.registeredCredentials.has(finId)) return;
    await this.finP2PContract.getCredentialAddress(finId);
    this.registeredCredentials.add(finId);
  }

  /**
   * Collateral-registry override: a collateral basket is a row in the shared
   * CollateralAgreementRegistry, not an operator-contract asset — FINP2POperator
   * cannot move it, and the registry only accepts writes from the collateral
   * agent key. When the asset's CAIP-19 standard names the collateral registry
   * (and the standard was registered at bootstrap from COLLATERAL_REGISTRY_ADDRESS
   * + COLLATERAL_AGENT_PRIVATE_KEY), escrow operations bypass finP2PContract and
   * go straight to the registered implementation, which signs with the agent key.
   */
  private collateralAsset(ast: Asset): { impl: TokenStandard; record: AssetRecord } | undefined {
    const std = ast.ledgerIdentifier?.standard;
    if (std?.toUpperCase() !== COLLATERAL_TOKEN_STANDARD || !tokenStandardRegistry.has(std)) return undefined;
    return {
      impl: tokenStandardRegistry.resolve(std),
      // the agreementId doubles as the record's contractAddress (an address-shaped
      // key into the shared registry) and arrives as the CAIP-19 tokenId
      record: { contractAddress: ast.ledgerIdentifier.tokenId, decimals: 0, tokenStandard: std },
    };
  }

  // the collateral standard holds its own agent signer and ignores wallet args;
  // this satisfies the TokenStandard signature only
  private operatorWallet(): TokenWallet {
    return { provider: this.finP2PContract.provider, signer: this.finP2PContract.signer };
  }

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    return mapReceiptOperation(await this.finP2PContract.getReceipt(id), undefined, this.execDetailsStore?.getExecutionContext(id));
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.finP2PContract.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op, undefined, this.execDetailsStore?.getExecutionContext(cid));
    return op as any;
  }

  public async createAsset(idempotencyKey: string, assetId: string,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    let tokenAddress: string;
    let allowanceRequired: boolean
    if (assetBind?.tokenIdentifier?.tokenId && isEthereumAddress(assetBind.tokenIdentifier.tokenId)) {
      tokenAddress = assetBind.tokenIdentifier.tokenId;
      allowanceRequired = true; // TODO: parse from metadata
      logger.debug(`Associating existing token ${tokenAddress} to asset ${assetId}`);
    } else {
      tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, DefaultDecimals, this.finP2PContract.finP2PContractAddress);
      allowanceRequired = false;
      logger.debug(`Deployed new token ${tokenAddress} for asset ${assetId}`);
    }

    const requestedStandard = assetBind?.tokenIdentifier?.standard;
    const responseStandard = requestedStandard ?? this.defaultAssetStandard;
    if (!responseStandard) {
      return failedAssetCreation(1, 'No asset standard supplied and DEFAULT_ASSET_STANDARD env not set');
    }
    // The basic FINP2POperator's associateAsset takes 2 args; the WithRegistry
    // variant takes 3 (extra bytes32 assetStandard). Only thread the standard
    // through when the deployed variant needs it.
    const assetStandardId = this.finP2PContract.variant === 'with-registry'
      ? (requestedStandard ? keccak256(toUtf8Bytes(requestedStandard)) : this.defaultAssetStandard!)
      : undefined;

    try {
      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress, assetStandardId);
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);
      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const network = `name: ${name}, chainId: ${chainId}`;
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network, tokenId: tokenAddress, standard: responseStandard },
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard: responseStandard,
        additionalContractDetails: {
          finP2POperatorContractAddress,
          allowanceRequired
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, destination: Destination, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const issuerFinId = destination.finId;
    try {
      await this.ensureCredential(issuerFinId);
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
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
    const collateral = this.collateralAsset(ast);
    if (collateral) {
      try {
        const to = await this.finP2PContract.getCredentialAddress(destination.finId);
        const opCtx = buildOperationContext(ast, signature, exCtx);
        const result = await collateral.impl.transfer(this.operatorWallet(), collateral.record, to, parseUnits(quantity, 0), pluginLogger, opCtx);
        return resultToReceipt(result, ast, "transfer", quantity, source, destination, exCtx, undefined);
      } catch (e) {
        logger.error(`Collateral transfer failed: asset=${ast.assetId} from=${source.finId} to=${destination.finId}`, e);
        return failedReceiptOperation(1, `${e}`);
      }
    }

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
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast, exCtx)
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(idempotencyKey: string, nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
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

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
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
    const collateral = this.collateralAsset(asset);
    if (collateral) {
      // a basket is never associated in the operator contract — read the registry
      const address = await this.finP2PContract.getCredentialAddress(finId);
      return collateral.impl.balanceOf(this.finP2PContract.provider, this.finP2PContract.signer, collateral.record, address, pluginLogger);
    }
    await this.ensureCredential(finId);
    return await this.finP2PContract.balance(asset.assetId, finId);
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    const balance = await this.getBalance(asset, finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

  public async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, ast: Asset,
    quantity: string, sgn: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const collateral = this.collateralAsset(ast);
    if (collateral) {
      try {
        const opCtx = buildOperationContext(ast, sgn, exCtx, operationId, deriveReleaseType(sgn, destination));
        const result = await collateral.impl.hold(this.operatorWallet(), this.operatorWallet(), collateral.record, parseUnits(quantity, 0), pluginLogger, opCtx);
        return resultToReceipt(result, ast, "hold", quantity, source, destination, exCtx, operationId);
      } catch (e) {
        logger.error(`Collateral hold failed: asset=${ast.assetId} source=${source.finId} operationId=${operationId}`, e);
        return failedReceiptOperation(1, `${e}`);
      }
    }

    const { signature, template } = sgn;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, operationId, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, signature);

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast, exCtx)
    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }


  }

  public async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const collateral = this.collateralAsset(asset);
    if (collateral) {
      try {
        const to = await this.finP2PContract.getCredentialAddress(destination.finId);
        const opCtx = buildOperationContext(asset, undefined, exCtx, operationId);
        const result = await collateral.impl.release(this.operatorWallet(), collateral.record, to, parseUnits(quantity, 0), pluginLogger, opCtx);
        return resultToReceipt(result, asset, "release", quantity, source, destination, exCtx, operationId);
      } catch (e) {
        logger.error(`Collateral release failed: asset=${asset.assetId} destination=${destination.finId} operationId=${operationId}`, e);
        return failedReceiptOperation(1, `${e}`);
      }
    }

    try {
      await this.ensureCredential(source.finId);
      await this.ensureCredential(destination.finId);
      const transactionReceipt = await this.finP2PContract.releaseTo(operationId, source.finId, destination.finId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  public async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const collateral = this.collateralAsset(asset);
    if (collateral) {
      try {
        const to = await this.finP2PContract.getCredentialAddress(source.finId);
        const opCtx = buildOperationContext(asset, undefined, exCtx, operationId);
        const result = await collateral.impl.release(this.operatorWallet(), collateral.record, to, parseUnits(quantity, 0), pluginLogger, opCtx);
        return resultToReceipt(result, asset, "release", quantity, source, undefined, exCtx, operationId);
      } catch (e) {
        logger.error(`Collateral rollback failed: asset=${asset.assetId} source=${source.finId} operationId=${operationId}`, e);
        return failedReceiptOperation(1, `${e}`);
      }
    }

    try {
      await this.ensureCredential(source.finId);
      const transactionReceipt = await this.finP2PContract.releaseBack(operationId, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }
}
