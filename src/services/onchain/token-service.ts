import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService, EscrowService,
  CommonService, HealthService, OperationStatus,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation, successfulReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  Receipt, ReceiptOperation, Source, Signature, SwapLeg, SwapOperation,
  successfulSwapOperation, failedSwapOperation,
  logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { Contract, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { Logger as SpiLogger, SwapIntent, SwapVenue, TokenWallet, mirrored } from "@owneraio/finp2p-ethereum-adapter-contract";
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

// the skeleton logger has warning() where the SPI wants warn()
const spiLogger: SpiLogger = {
  debug: (message, ...args) => logger.debug(message, ...args),
  info: (message, ...args) => logger.info(message, ...args),
  warn: (message, ...args) => logger.warning(message, ...args),
  error: (message, ...args) => logger.error(message, ...args),
};

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
    // swap execution venue (SPI plugin), constructed at app startup from
    // FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS when that env var is set
    readonly swapVenue: SwapVenue | undefined = undefined,
  ) {}

  // the operator wallet submits venue transactions; the venue contract pulls
  // from — and settles to — the parties' allowance-granting wallets
  private operatorWallet(): TokenWallet {
    return { provider: this.finP2PContract.provider, signer: this.finP2PContract.signer };
  }

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
    // an empty tokenId — or one that isn't a token address on this ledger (the
    // router/tests still send asset codes like 'USD' or the finp2p resource id
    // here) — is the "create it for me" signal: deploy a new token
    const requestedTokenId = assetBind?.tokenIdentifier?.tokenId;
    if (requestedTokenId && isEthereumAddress(requestedTokenId)) {
      tokenAddress = requestedTokenId;
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
   * Translate the request's finId/assetId legs into the venue's address/raw-units
   * intent: token via the operator's asset association, party via the credentials
   * registry, amounts scaled by the token's own decimals.
   */
  private async toSwapIntent(operationId: string, assetLeg: SwapLeg, settlementLeg: SwapLeg, deadline: number): Promise<SwapIntent> {
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
    return {
      operationId,
      give: { token, party, amount },
      take: { token: counterToken, party: counterParty, amount: counterAmount },
      deadline: deadline || undefined,
    };
  }

  private async toTokenUnits(token: string, quantity: string): Promise<bigint> {
    const erc20 = new Contract(token, ["function decimals() view returns (uint8)"], this.finP2PContract.provider);
    return parseUnits(quantity, await erc20.decimals());
  }

  /** Submit this side's leg through the venue; the venue resolves only once both legs cross (polling is internal to it). */
  private async swapViaVenue(swapVenue: SwapVenue, operationId: string, assetLeg: SwapLeg,
                             settlementLeg: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    const intent = await this.toSwapIntent(operationId, assetLeg, settlementLeg, deadline);
    const submission = await swapVenue.swap(this.operatorWallet(), intent, spiLogger);
    if (submission.status === "failure") {
      return failedSwapOperation(1, submission.reason);
    }
    const { transactionId, timestamp } = submission;
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
    }
    return successfulSwapOperation(
      swapMovementReceipt(`${transactionId}:${assetLeg.asset.assetId}`, transactionId, operationId, assetLeg, exCtx, timestamp),
    );
  }

  /**
   * Atomic same-ledger swap through the configured SwapVenue (SPI plugin, the
   * operator contract is no longer used for swap): `assetLeg` is the leg this
   * adapter executes, `settlementLeg` the binding counter-leg. The venue's
   * swap() honors the SPI's synchronous contract — it resolves only once BOTH
   * legs have crossed (or fails at the deadline), so both parties resolve with
   * the SAME transaction id: the one that moved both legs. Long-blocking is
   * safe: the workflow proxy answers the HTTP call with a pending cid and the
   * router polls the final result. Completes with the single receipt of this
   * adapter's own (asset) leg.
   *
   * `numberOfReceipts` selects the mode: 1 = cross-org (counterparty's adapter
   * mirrors the settlement leg), 2 = same-org (both wallets are operated here —
   * this adapter drives both mirror calls itself and completes with both leg
   * receipts).
   */
  public async swap(idempotencyKey: string, nonce: string, operationId: string, assetLeg: SwapLeg,
                    settlementLeg: SwapLeg, numberOfReceipts: number, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    if (numberOfReceipts === 2) {
      return this.swapBothLegs(operationId, assetLeg, settlementLeg, deadline, exCtx);
    }
    if (numberOfReceipts !== 1) {
      return failedSwapOperation(1, `numberOfReceipts must be 1 or 2, got ${numberOfReceipts}`);
    }
    try {
      if (!this.swapVenue) {
        return failedSwapOperation(1, "Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      if (!assetLeg.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      // absolute epoch seconds; the venue enforces it as its wait bound
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

      return await this.swapViaVenue(this.swapVenue, operationId, assetLeg, settlementLeg, deadline, exCtx);
    } catch (e) {
      logger.error(`Error on swap: ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapOperation(1, e.message);
      }
      return failedSwapOperation(1, `${e}`);
    }
  }

  /**
   * Both-legs swap through the venue: both mirrored swap calls are submitted
   * IN PARALLEL, both signed by the operator. The venue's swap() resolves only
   * once both legs have crossed (it polls internally — the SPI exposes no
   * separate prepared/executed states), so submitting sequentially would block
   * the first call forever waiting for a mirror that never comes.
   */
  private async swapBothLegsViaVenue(swapVenue: SwapVenue, operationId: string, asset: SwapLeg,
                                     settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    const intent = await this.toSwapIntent(operationId, asset, settlement, deadline);
    const [assetSubmission, settlementSubmission] = await Promise.all([
      swapVenue.swap(this.operatorWallet(), intent, spiLogger),
      swapVenue.swap(this.operatorWallet(), mirrored(intent), spiLogger),
    ]);
    if (assetSubmission.status === "failure") {
      return failedSwapOperation(1, assetSubmission.reason);
    }
    if (settlementSubmission.status === "failure") {
      return failedSwapOperation(1, settlementSubmission.reason);
    }
    // both submissions attest the same executing transaction
    const { transactionId, timestamp } = assetSubmission;
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
    }
    return successfulSwapOperation(
      swapMovementReceipt(`${transactionId}:${asset.asset.assetId}`, transactionId, operationId, asset, exCtx, timestamp),
      swapMovementReceipt(`${transactionId}:${settlement.asset.assetId}`, transactionId, operationId, settlement, exCtx, timestamp),
    );
  }

  /**
   * Same-org swap (numberOfReceipts = 2, both wallets operated here) through
   * the configured SwapVenue: drive both mirrored perspectives ourselves, in
   * parallel (see swapBothLegsViaVenue). Completes with both leg receipts,
   * both attesting the same executing tx.
   */
  private async swapBothLegs(operationId: string, asset: SwapLeg,
                             settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    try {
      if (!this.swapVenue) {
        return failedSwapOperation(1, "Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      // both wallets are custodied here, and each leg carries its own owner's
      // signature over the full swap terms
      if (!asset.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      if (!settlement.signature) {
        return failedSwapOperation(1, "settlement leg signature is required");
      }
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
      }
      // same mirror invariant as the two-party swap: the contract settles each
      // leg back to the counter-leg's sender
      if (asset.destination.finId !== settlement.source.finId) {
        return failedSwapOperation(1, `asset destination finId '${asset.destination.finId}' does not match settlement source finId '${settlement.source.finId}'`);
      }
      if (settlement.destination.finId !== asset.source.finId) {
        return failedSwapOperation(1, `settlement destination finId '${settlement.destination.finId}' does not match asset source finId '${asset.source.finId}'`);
      }
      const { chainId } = await this.finP2PContract.provider.getNetwork();
      validateSwapWallets(asset, settlement, chainId);

      return await this.swapBothLegsViaVenue(this.swapVenue, operationId, asset, settlement, deadline, exCtx);
    } catch (e) {
      logger.error(`Error on swap (both legs): ${e}`);
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
