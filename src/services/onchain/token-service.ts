import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService, EscrowService,
  CommonService, HealthService, OperationStatus,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation, successfulReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  Receipt, ReceiptOperation, Source, Signature, SwapLeg, SwapOperation, SwapSingleOperation,
  successfulSwapOperation, failedSwapOperation, successfulSwapSingleOperation, failedSwapSingleOperation,
  logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { Contract, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import {
  AllowanceSwap,
  SwapLeg as AllowanceSwapLeg,
  mirrored,
} from "@owneraio/finp2p-ethereum-allowance-swap";
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

// wait bound when the request carries no deadline
const DefaultSwapWaitSeconds = 300;

/** A swap settles as ONE ledger tx with two movements; the receipt attests this adapter's own leg. */
const swapMovementReceipt = (id: string, transactionId: string, operationId: string, leg: SwapLeg,
                             exCtx: ExecutionContext | undefined, timestamp: number): Receipt => ({
  id,
  asset: leg.asset,
  source: leg.source,
  destination: leg.destination,
  quantity: leg.quantity,
  operationType: "swap",
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
    readonly allowanceSwap: AllowanceSwap | undefined = undefined,
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
   * Translate the request's finId/assetId legs into the standalone AllowanceSwap
   * contract's address/raw-units leg: token via the operator's asset association,
   * party via the credentials registry, amounts scaled by the token's own decimals.
   */
  private async toAllowanceSwapLeg(assetLeg: SwapLeg, settlementLeg: SwapLeg): Promise<AllowanceSwapLeg> {
    const [token, counterToken, party, counterParty] = await Promise.all([
      this.finP2PContract.getAssetAddress(assetLeg.asset.assetId),
      this.finP2PContract.getAssetAddress(settlementLeg.asset.assetId),
      this.finP2PContract.getCredentialAddress(assetLeg.source.finId),
      this.finP2PContract.getCredentialAddress(settlementLeg.source.finId),
    ]);
    const [amount, counterAmount] = await Promise.all([
      this.toTokenUnits(token, assetLeg.quantity),
      this.toTokenUnits(counterToken, settlementLeg.quantity),
    ]);
    return { token, party, amount, counterToken, counterParty, counterAmount };
  }

  private async toTokenUnits(token: string, quantity: string): Promise<bigint> {
    const erc20 = new Contract(token, ["function decimals() view returns (uint8)"], this.finP2PContract.provider);
    return parseUnits(quantity, await erc20.decimals());
  }

  /** Same prepare/execute mirror semantics as the operator-contract path, against the standalone AllowanceSwap contract. */
  private async swapViaAllowanceContract(allowanceSwap: AllowanceSwap, operationId: string, assetLeg: SwapLeg,
                                         settlementLeg: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    const leg = await this.toAllowanceSwapLeg(assetLeg, settlementLeg);
    const result = await allowanceSwap.swap(operationId, leg);
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(result.transactionHash, exCtx.planId, exCtx.sequence);
    }

    let transactionId: string;
    let timestamp: number;
    if (result.status === "executed") {
      transactionId = result.transactionHash;
      timestamp = (await this.finP2PContract.provider.getBlock(result.blockNumber))?.timestamp ?? 0;
    } else {
      const executed = await allowanceSwap.waitForExecution(operationId, {
        fromBlock: result.blockNumber,
        deadline: deadline || Math.floor(Date.now() / 1000) + DefaultSwapWaitSeconds,
      });
      if (!executed) {
        return failedSwapOperation(1, `swap ${operationId} was prepared (tx ${result.transactionHash}) but the counterparty did not execute it before the deadline`);
      }
      ({ transactionHash: transactionId, timestamp } = executed);
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
      }
    }
    return successfulSwapOperation(
      swapMovementReceipt(`${transactionId}:${assetLeg.asset.assetId}`, transactionId, operationId, assetLeg, exCtx, timestamp),
    );
  }

  /**
   * Atomic same-ledger swap via the standalone AllowanceSwap contract
   * (FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS — the operator contract is no
   * longer used for swap): `assetLeg` is the leg this adapter executes,
   * `settlementLeg` the binding counter-leg. First mirror call prepares
   * (SwapPrepared), the second crosses both movements in one tx (SwapExecuted).
   * Behaves synchronously: the preparing side blocks until the counterparty's
   * executing transaction is observed (or the deadline passes), so both parties
   * resolve with the SAME transaction id — the one that moved both legs.
   * Long-blocking is safe: the workflow proxy answers the HTTP call with a
   * pending cid and the router polls the final result. Completes with the
   * single receipt of this adapter's own (asset) leg.
   */
  public async swap(idempotencyKey: string, nonce: string, operationId: string, assetLeg: SwapLeg,
                    settlementLeg: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    try {
      if (!this.allowanceSwap) {
        return failedSwapOperation(1, "Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      if (!assetLeg.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      // absolute epoch seconds; enforced adapter-side as the wait bound below —
      // the operator contract itself has no expiry, so an already-prepared leg
      // stays executable on-chain past the deadline
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

      return await this.swapViaAllowanceContract(this.allowanceSwap, operationId, assetLeg, settlementLeg, deadline, exCtx);
    } catch (e) {
      logger.error(`Error on swap: ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapOperation(1, e.message);
      }
      return failedSwapOperation(1, `${e}`);
    }
  }

  /** Single-call swap through the standalone AllowanceSwap contract: prepare then execute the mirror, both signed by the operator. */
  private async swapSingleViaAllowanceContract(allowanceSwap: AllowanceSwap, operationId: string, asset: SwapLeg,
                                               settlement: SwapLeg, exCtx: ExecutionContext | undefined): Promise<SwapSingleOperation> {
    const leg = await this.toAllowanceSwapLeg(asset, settlement);
    const first = await allowanceSwap.swap(operationId, leg);
    let executed = first;
    if (first.status !== "executed") {
      executed = await allowanceSwap.swap(operationId, mirrored(leg));
      if (executed.status !== "executed") {
        return failedSwapSingleOperation(1, `swapSingle ${operationId}: mirror call ${executed.transactionHash} did not execute the swap prepared by ${first.transactionHash}`);
      }
    }
    const transactionId = executed.transactionHash;
    const timestamp = (await this.finP2PContract.provider.getBlock(executed.blockNumber))?.timestamp ?? 0;
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
    }
    return successfulSwapSingleOperation(
      swapMovementReceipt(`${transactionId}:${asset.asset.assetId}`, transactionId, operationId, asset, exCtx, timestamp),
      swapMovementReceipt(`${transactionId}:${settlement.asset.assetId}`, transactionId, operationId, settlement, exCtx, timestamp),
    );
  }

  /**
   * Single-call swap (both wallets custodied here) via the standalone
   * AllowanceSwap contract: drive its two-party prepare/execute mirror
   * ourselves — first call from the asset owner's perspective (SwapPrepared),
   * then the mirrored call from the settlement owner's perspective, which
   * crosses both movements in one tx (SwapExecuted). Completes with both leg
   * receipts, both attesting that executing tx.
   */
  public async swapSingle(idempotencyKey: string, nonce: string, operationId: string, asset: SwapLeg,
                          settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapSingleOperation> {
    try {
      if (!this.allowanceSwap) {
        return failedSwapSingleOperation(1, "Single-call swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapSingleOperation(1, "operationId is required");
      }
      // both wallets are custodied here, and each leg carries its own owner's
      // signature over the full swap terms
      if (!asset.signature) {
        return failedSwapSingleOperation(1, "asset leg signature is required");
      }
      if (!settlement.signature) {
        return failedSwapSingleOperation(1, "settlement leg signature is required");
      }
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapSingleOperation(1, `swap deadline ${deadline} has already passed`);
      }
      // same mirror invariant as the two-party swap: the contract settles each
      // leg back to the counter-leg's sender
      if (asset.destination.finId !== settlement.source.finId) {
        return failedSwapSingleOperation(1, `asset destination finId '${asset.destination.finId}' does not match settlement source finId '${settlement.source.finId}'`);
      }
      if (settlement.destination.finId !== asset.source.finId) {
        return failedSwapSingleOperation(1, `settlement destination finId '${settlement.destination.finId}' does not match asset source finId '${asset.source.finId}'`);
      }
      const { chainId } = await this.finP2PContract.provider.getNetwork();
      validateSwapWallets(asset, settlement, chainId);

      return await this.swapSingleViaAllowanceContract(this.allowanceSwap, operationId, asset, settlement, exCtx);
    } catch (e) {
      logger.error(`Error on swapSingle: ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapSingleOperation(1, e.message);
      }
      return failedSwapSingleOperation(1, `${e}`);
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
