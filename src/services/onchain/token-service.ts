import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService, EscrowService,
  CommonService, HealthService, OperationStatus,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation,
  failedSwapOperation, pendingSwapOperation, successfulSwapOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  Receipt, ReceiptOperation, Source, Signature, SwapLeg, SwapOperation,
  logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { keccak256, toUtf8Bytes } from "ethers";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  ValidationError,
  term, isEthereumAddress
} from "@owneraio/finp2p-ethereum-orchestrator";
import { FinP2PClient } from "@owneraio/finp2p-client";

import { ExecDetailsStore } from "./exec-details-store";
import { mapReceiptOperation } from "./mapping";
import { emptyOperationParams, extractBusinessDetails, validateRequest } from "./helpers";
import { validateSwapWallets } from "../accounts";

const DefaultDecimals = 2;

/** A swap settles as ONE ledger tx with two movements; each receipt attests one of them. */
const swapMovementReceipt = (id: string, transactionId: string, operationId: string, leg: SwapLeg,
                             exCtx: ExecutionContext | undefined, timestamp: number): Receipt => ({
  id,
  asset: leg.asset,
  source: leg.source,
  destination: leg.destination,
  quantity: leg.quantity,
  operationType: "transfer",
  proof: undefined,
  timestamp,
  tradeDetails: { executionContext: exCtx },
  transactionDetails: { transactionId, operationId },
});

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

  /**
   * Atomic same-ledger swap via the operator contract (allowance-based):
   * `assetLeg` is the leg this adapter executes, `settlementLeg` the binding
   * counter-leg. First mirror call prepares (SwapPrepared -> pending), the
   * second crosses both movements in one tx (SwapExecuted -> two receipts).
   */
  public async swap(idempotencyKey: string, nonce: string, operationId: string, assetLeg: SwapLeg,
                    settlementLeg: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    try {
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      if (!assetLeg.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      // absolute epoch seconds; the current operator contract has no expiry support,
      // so only an already-passed deadline is rejected here
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
      }
      // two-party mirror: the contract delivers the asset to the settlement sender's
      // wallet and the settlement back to the asset sender's — a request naming
      // other receivers cannot be honored
      if (assetLeg.destination.finId !== settlementLeg.source.finId) {
        return failedSwapOperation(1, `asset destination finId '${assetLeg.destination.finId}' does not match settlement source finId '${settlementLeg.source.finId}'`);
      }
      if (settlementLeg.destination.finId !== assetLeg.source.finId) {
        return failedSwapOperation(1, `settlement destination finId '${settlementLeg.destination.finId}' does not match asset source finId '${assetLeg.source.finId}'`);
      }

      // any wallet address carried on the legs must be a valid EVM address on this chain
      const { chainId } = await this.finP2PContract.provider.getNetwork();
      const { approvalWallet, destinationWallet } = validateSwapWallets(assetLeg, settlementLeg, chainId);

      // the contract pulls the asset from — and settles the counter-leg to — the
      // registered credential wallet; an explicitly requested wallet must be that one
      const ourWallet = await this.finP2PContract.getCredentialAddress(assetLeg.source.finId);
      if (approvalWallet && approvalWallet.toLowerCase() !== ourWallet.toLowerCase()) {
        return failedSwapOperation(1, `asset source wallet ${approvalWallet} does not match the registered credential ${ourWallet} holding the allowance`);
      }
      if (destinationWallet && destinationWallet.toLowerCase() !== ourWallet.toLowerCase()) {
        return failedSwapOperation(1, `settlement destination wallet ${destinationWallet} does not match the registered credential ${ourWallet} the swap settles to`);
      }

      const txReceipt = await this.finP2PContract.swap(operationId, {
        assetId: assetLeg.asset.assetId,
        assetFinId: assetLeg.source.finId,
        assetAmount: assetLeg.quantity,
        settlementAssetId: settlementLeg.asset.assetId,
        settlementFinId: settlementLeg.source.finId,
        settlementAmount: settlementLeg.quantity,
      });
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(txReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      const executed = txReceipt.logs.some((log) => {
        try {
          return this.finP2PContract.contractInterface.parseLog({ topics: [...log.topics], data: log.data })?.name === "SwapExecuted";
        } catch {
          return false;
        }
      });
      if (!executed) {
        // first leg recorded (SwapPrepared) — crosses when the counterparty submits the mirror
        return pendingSwapOperation(txReceipt.hash, undefined);
      }
      const timestamp = (await txReceipt.getBlock()).timestamp;
      return successfulSwapOperation(
        swapMovementReceipt(`${txReceipt.hash}:0`, txReceipt.hash, operationId, assetLeg, exCtx, timestamp),
        swapMovementReceipt(`${txReceipt.hash}:1`, txReceipt.hash, operationId, settlementLeg, exCtx, timestamp),
      );
    } catch (e) {
      logger.error(`Error on swap: ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapOperation(1, e.message);
      }
      return failedSwapOperation(1, `${e}`);
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

  public async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, ast: Asset,
    quantity: string, sgn: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
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
