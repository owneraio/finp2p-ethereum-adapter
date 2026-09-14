import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination,
  Balance, Destination, ExecutionContext, HealthService, OperationType, Receipt,
  ReceiptOperation, Signature, Source, SwapLeg, SwapOperation, TokenService, EscrowService,
  failedReceiptOperation, failedAssetCreation, failedSwapOperation,
  successfulSwapOperation
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import winston from 'winston';
import { Contract, parseUnits, Provider, Signer, Wallet, ZeroAddress } from "ethers";
import { AssetRecord, ReleaseType, TokenOperationResult, SwapIntent, SwapVenue, mirrored } from '@owneraio/finp2p-ethereum-adapter-contract';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { AccountResolver, AssetStore, ledgerAccountAddress, validateSwapWallets } from "../accounts";
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';
import { TokenStandardName as ERC20_TOKEN_STANDARD, DEFAULT_NEW_ERC20_DECIMALS } from '@owneraio/finp2p-ethereum-erc20-plugin';
import { buildOperationContext, deriveReleaseType } from "../operations";

function resultToReceipt(
  result: TokenOperationResult, ast: Asset, operationType: OperationType, quantity: string,
  source: Source | undefined,
  destination: Destination | undefined,
  exCtx: ExecutionContext | undefined, operationId: string | undefined,
): ReceiptOperation {
  if (result.status === 'failure') {
    return failedReceiptOperation(1, result.reason);
  }
  return {
    operation: "receipt",
    type: "success",
    receipt: {
      id: result.transactionId,
      asset: ast,
      source,
      destination,
      operationType,
      proof: undefined,
      quantity,
      timestamp: result.timestamp,
      tradeDetails: { executionContext: exCtx },
      transactionDetails: { operationId, transactionId: result.transactionId }
    }
  };
}

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
 * Custody-backed token & escrow operations (direct account model).
 *
 * Gas model — funding is plan-scoped, not per-operation: the signing wallets
 * of a plan's instructions are topped up once at plan approval by
 * GasPrefundingOption (see ConfigurablePlanApprovalService), so these methods
 * assume the wallet they sign with already holds gas and do not self-fund.
 *
 * Consequence: an operation reaching these methods WITHOUT a preceding
 * approvePlan for its plan — a standalone/non-plan call, or a wallet drained
 * between approval and execution — will fail with an insufficient-funds error
 * rather than lazily topping up. If a deployment needs standalone direct
 * operations with self-funding, wallets must be funded out of band (or a
 * gas-check step reintroduced explicitly for that path).
 */
export class CustodyTokenService implements TokenService, EscrowService, HealthService {

  constructor(
    readonly logger: winston.Logger,
    readonly custodyProvider: CustodyProvider,
    readonly escrowWallet: CustodyWallet,
    readonly readProvider: Provider,
    readonly accountMapping: AccountResolver,
    readonly assetStore: AssetStore,
    // env-injected issuer (ASSET_ISSUER_PRIVATE_KEY) — signs deploys and is the
    // per-call wallet for mint; never a custody wallet. Absent when the key is
    // not configured: deploy/issue then fail closed instead of stranding assets
    // behind a throwaway signer.
    readonly issuerWallet: CustodyWallet | undefined,
    // swap execution venue (SPI plugin), constructed at app startup from
    // FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS when that env var is set
    readonly swapVenue?: SwapVenue,
    // the venue contract both parties must ERC20-approve before swapping;
    // allowance-based venues ignore intent permits
    readonly swapVenueApprovalAddress?: string,
  ) {}

  // read-only paths need a Signer arg for the SPI; an ephemeral one suffices
  private readSigner?: Signer;

  private issuerSigner(): Signer {
    if (this.issuerWallet) return this.issuerWallet.signer;
    this.readSigner ??= Wallet.createRandom().connect(this.readProvider);
    return this.readSigner;
  }

  async liveness(): Promise<void> {
    await this.readProvider.getNetwork();
  }

  async readiness(): Promise<void> {
    await this.readProvider.getBlockNumber();
  }

  private async resolveAddress(finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) throw new Error(`Cannot resolve address for finId: ${finId}`);
    return address;
  }

  private async assetRecord(assetId: string): Promise<AssetRecord> {
    const dbAsset = await this.assetStore.getAsset(assetId);
    if (dbAsset === undefined) throw new Error(`Asset ${assetId} is not registered in DB`);
    return {
      contractAddress: dbAsset.contract_address,
      decimals: dbAsset.decimals,
      tokenStandard: dbAsset.token_standard,
    };
  }

  private async resolveSourceWallet(finId: string): Promise<{ address: string; wallet: CustodyWallet } | undefined> {
    const full = this.accountMapping.resolveFullAccount
      ? await this.accountMapping.resolveFullAccount(finId)
      : undefined;

    if (full?.custodyAccountId && this.custodyProvider.createWalletForCustodyId) {
      const wallet = await this.custodyProvider.createWalletForCustodyId(full.custodyAccountId);
      return { address: full.ledgerAccountId, wallet };
    }

    const address = full?.ledgerAccountId ?? await this.accountMapping.resolveAccount(finId);
    if (!address) return undefined;
    const wallet = await this.custodyProvider.resolveWallet(address);
    if (!wallet) return undefined;
    return { address, wallet };
  }

  async createAsset(
    idempotencyKey: string, assetId: string, assetBind: AssetBind | undefined,
    assetMetadata: any, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
  ): Promise<AssetCreationStatus> {
    const explicitStandard = assetBind?.tokenIdentifier?.standard;
    const requestedStandard = explicitStandard ?? ERC20_TOKEN_STANDARD;
    if (!tokenStandardRegistry.has(requestedStandard)) {
      return failedAssetCreation(1, `Unsupported token standard '${requestedStandard}'; available: ${tokenStandardRegistry.availableStandards.join(', ')}`);
    }
    const standard = tokenStandardRegistry.resolve(requestedStandard);
    this.logger.info(`createAsset: assetId=${assetId} token standard '${requestedStandard}'${explicitStandard === undefined ? ' (defaulted, none requested)' : ''} resolved to ${standard.constructor.name}`);

    const { chainId } = await this.readProvider.getNetwork();
    const defaultNetwork = `eip155:${chainId}`;
    const requestedNetwork = assetBind?.tokenIdentifier?.network;
    if (requestedNetwork && requestedNetwork !== defaultNetwork) {
      return failedAssetCreation(1, `Unsupported network '${requestedNetwork}'; this adapter serves ${defaultNetwork}`);
    }

    // an empty tokenId is the "create it for me" signal — deploy a new token
    const tokenAddress = assetBind?.tokenIdentifier?.tokenId;
    if (!tokenAddress) {
      this.logger.info(`createAsset: deploy path — assetId=${assetId} standard=${requestedStandard} name=${assetName ?? 'OWNERACOIN'}`);
      if (!this.issuerWallet) {
        return failedAssetCreation(1, 'ASSET_ISSUER_PRIVATE_KEY is not set — refusing to deploy an asset a throwaway signer would strand');
      }
      const wallet = this.issuerWallet;
      const symbol = "OWNERA"; // TODO: align with product team which metadata fields to use for token name/symbol/decimals
      const result = await standard.deploy(wallet, assetName ?? "OWNERACOIN", symbol, DEFAULT_NEW_ERC20_DECIMALS, this.logger);
      await this.assetStore.saveAsset({
        contract_address: result.contractAddress,
        decimals: result.decimals,
        token_standard: result.tokenStandard,
        id: assetId,
      });
      // TODO(custody-registration): onAssetRegistered forwards to the custody
      // provider's ERC20 registration (Fireblocks registerNewAsset). It is an
      // ERC20-custody-only concern — collateral/registry standards are not
      // custody-held tokens and fail registration — and it lost its gate when
      // isErc20Compatible was retired. Disabled pending a purpose-specific
      // capability; reassess whether this feature is needed before re-enabling.
      // await this.custodyProvider.onAssetRegistered?.(result.contractAddress, symbol);

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: defaultNetwork, tokenId: result.contractAddress, standard: result.tokenStandard }, reference: undefined }
      };
    } else {
      this.logger.info(`createAsset: bind path — assetId=${assetId} standard=${requestedStandard} tokenAddress=${tokenAddress} network=${requestedNetwork ?? defaultNetwork}`);

      const decimals = await standard.decimals(this.readProvider, tokenAddress, this.logger);
      this.logger.info(`createAsset: standard '${requestedStandard}' reported decimals=${decimals} for ${tokenAddress}`);
      await this.assetStore.saveAsset({
        contract_address: tokenAddress,
        decimals,
        token_standard: requestedStandard,
        id: assetId,
      });

      // TODO(custody-registration): see the deploy path above — disabled pending
      // a purpose-specific capability; reassess before re-enabling.
      // await this.custodyProvider.onAssetRegistered?.(tokenAddress);

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: requestedNetwork || defaultNetwork, tokenId: tokenAddress, standard: requestedStandard }, reference: undefined }
      };
    }
  }

  async getBalance(ast: Asset, finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) return "0";
    const asset = await this.assetRecord(ast.assetId);
    const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
    return standard.balanceOf(
      this.readProvider, this.issuerSigner(),
      asset, address, this.logger,
    );
  }

  async balance(ast: Asset, finId: string): Promise<Balance> {
    const b = await this.getBalance(ast, finId);
    return { current: b, available: b, held: "0" };
  }

  async issue(
    idempotencyKey: string, ast: Asset, destination: Destination, quantity: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const wallet = this.issuerWallet;
      if (!wallet) return failedReceiptOperation(1, 'ASSET_ISSUER_PRIVATE_KEY is not set — issuance is disabled');
      const address = await this.accountMapping.resolveAccount(destination.finId)
        ?? ledgerAccountAddress(destination.account, (await this.readProvider.getNetwork()).chainId);
      if (!address) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const amount = parseUnits(quantity, asset.decimals);

      const result = await standard.mint(wallet, asset, address, amount, this.logger);
      return resultToReceipt(result, ast, "issue", quantity, destination, destination, exCtx, undefined);
    } catch (e) {
      this.logger.error(`Issue failed: asset=${ast.assetId} to=${destination.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async transfer(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    ast: Asset, quantity: string, signature: Signature,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      const destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
        ?? ledgerAccountAddress(destination.account, (await this.readProvider.getNetwork()).chainId);
      if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const opCtx = buildOperationContext(ast, signature, exCtx);
      const result = await standard.transfer(wallet, asset, destinationAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "transfer", quantity, source, destination, exCtx, undefined);
    } catch (e) {
      this.logger.error(`Transfer failed: asset=${ast.assetId} from=${source.finId} to=${destination.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  /**
   * The swap venue wants addresses and raw token units; the request carries
   * finIds, assetIds and decimal quantities. Token address + decimals come
   * from the asset store — both legs must be registered assets here.
   */
  private async toSwapIntent(operationId: string, asset: SwapLeg, settlement: SwapLeg,
                             party: string, counterParty: string, deadline: number): Promise<SwapIntent> {
    const assetRecord = await this.assetRecord(asset.asset.assetId);
    const settlementRecord = await this.assetRecord(settlement.asset.assetId);
    return {
      operationId,
      give: { token: assetRecord.contractAddress, party, amount: parseUnits(asset.quantity, assetRecord.decimals) },
      take: { token: settlementRecord.contractAddress, party: counterParty, amount: parseUnits(settlement.quantity, settlementRecord.decimals) },
      deadline: deadline || undefined,
    };
  }

  // TODO: the venue contract is permissionless — an allowance granted here is spendable by ANY
  // mirrored pair naming this party, not just this operationId. Exact per-swap amounts limit
  // the exposure but don't remove it (a competing swap can still consume the approval).
  // Needs review later.
  private async approveToSwapVenue(signer: Signer, token: string, amount: bigint): Promise<void> {
    const erc20 = new Contract(token, ["function approve(address spender, uint256 amount) returns (bool)"], signer);
    const tx = await erc20.approve(this.swapVenueApprovalAddress!, amount);
    await tx.wait();
  }

  /**
   * Atomic same-ledger swap through the configured SwapVenue (SPI plugin):
   * this adapter submits its own (asset) leg signed by the asset source's
   * custody wallet; the venue resolves only once both legs have crossed
   * (the counterparty's mirrored call), or fails at the deadline — the
   * polling is internal to the venue. Without a configured venue the
   * request is validated and fails closed as before.
   *
   * `numberOfReceipts` selects the mode: 1 = cross-org (this adapter executes
   * only its own asset leg, counterparty mirrors), 2 = same-org (both wallets
   * custodied here — this adapter drives both mirror calls itself and completes
   * with both leg receipts).
   */
  async swap(
    idempotencyKey: string, nonce: string, operationId: string, asset: SwapLeg,
    settlement: SwapLeg, numberOfReceipts: number, deadline: number, exCtx: ExecutionContext | undefined
  ): Promise<SwapOperation> {
    if (numberOfReceipts === 2) {
      return this.swapBothLegs(operationId, asset, settlement, deadline, exCtx);
    }
    if (numberOfReceipts !== 1) {
      return failedSwapOperation(1, `numberOfReceipts must be 1 or 2, got ${numberOfReceipts}`);
    }
    try {
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
      }
      // any wallet address carried on the legs must be a valid EVM address on this chain
      const { chainId } = await this.readProvider.getNetwork();
      const { approvalWallet, destinationWallet } = validateSwapWallets(asset, settlement, chainId);

      if (!this.swapVenue) {
        // "approval from" (asset source) and "swap to" (settlement destination) wallets:
        // taken from the leg accounts when present, otherwise from the account mapping
        const approval = approvalWallet ?? await this.accountMapping.resolveAccount(asset.source.finId);
        if (!approval) return failedSwapOperation(1, `No wallet address for asset source ${asset.source.finId} — pass source.account or map the finId`);
        const to = destinationWallet ?? await this.accountMapping.resolveAccount(settlement.destination.finId);
        if (!to) return failedSwapOperation(1, `No wallet address for settlement destination ${settlement.destination.finId} — pass destination.account or map the finId`);
        this.logger.info(`Swap ${operationId}: approval from ${approval}, settle to ${to} — no swap venue is configured (FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set)`);
        return failedSwapOperation(1, 'Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set');
      }

      // two-party mirror: the contract delivers the asset to the settlement sender's
      // wallet and the settlement back to the asset sender's — a request naming
      // other receivers cannot be honored
      if (asset.destination.finId !== settlement.source.finId) {
        return failedSwapOperation(1, `asset destination finId '${asset.destination.finId}' does not match settlement source finId '${settlement.source.finId}'`);
      }
      if (settlement.destination.finId !== asset.source.finId) {
        return failedSwapOperation(1, `settlement destination finId '${settlement.destination.finId}' does not match asset source finId '${asset.source.finId}'`);
      }

      const resolved = await this.resolveSourceWallet(asset.source.finId);
      if (!resolved) return failedSwapOperation(1, `Asset source ${asset.source.finId} cannot be resolved to a custody wallet`);
      if (approvalWallet && approvalWallet.toLowerCase() !== resolved.address.toLowerCase()) {
        return failedSwapOperation(1, `asset source wallet ${approvalWallet} does not match the custody wallet ${resolved.address} holding the allowance`);
      }
      if (destinationWallet && destinationWallet.toLowerCase() !== resolved.address.toLowerCase()) {
        return failedSwapOperation(1, `settlement destination wallet ${destinationWallet} does not match the custody wallet ${resolved.address} the swap settles to`);
      }

      // the counterparty's wallet: from the leg account when present, otherwise the mapping
      const counterParty = ledgerAccountAddress(settlement.source.account, chainId)
        ?? await this.accountMapping.resolveAccount(settlement.source.finId);
      if (!counterParty) return failedSwapOperation(1, `No wallet address for settlement source ${settlement.source.finId} — pass source.account or map the finId`);

      const intent = await this.toSwapIntent(operationId, asset, settlement, resolved.address, counterParty, deadline);
      await this.approveToSwapVenue(resolved.wallet.signer, intent.give.token, intent.give.amount);
      // the venue resolves only once both legs have crossed (or the deadline
      // passes) — waiting for the counterparty's mirror is internal to it
      const submission = await this.swapVenue.swap(resolved.wallet, intent, this.logger);
      if (submission.status === 'failure') {
        return failedSwapOperation(1, submission.reason);
      }
      const { transactionId, timestamp } = submission;
      return successfulSwapOperation(
        swapMovementReceipt(`${transactionId}:${asset.asset.assetId}`, transactionId, operationId, asset, exCtx, timestamp),
      );
    } catch (e) {
      this.logger.error(`Swap failed: operationId=${operationId} asset=${asset.asset.assetId} settlement=${settlement.asset.assetId}`, e);
      return failedSwapOperation(1, `${e}`);
    }
  }

  /**
   * Same-org swap (numberOfReceipts = 2, both wallets custodied here) through
   * the configured SwapVenue: both mirrored swap calls are submitted IN
   * PARALLEL — the venue's swap() resolves only once both legs have crossed
   * (it polls internally, there is no separate prepared/executed state on the
   * SPI), so submitting sequentially would block the first call forever
   * waiting for a mirror that never comes. Completes with both leg receipts.
   */
  private async swapBothLegs(
    operationId: string, asset: SwapLeg,
    settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined
  ): Promise<SwapOperation> {
    try {
      if (!this.swapVenue) {
        return failedSwapOperation(1, 'Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set');
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
      const { chainId } = await this.readProvider.getNetwork();
      validateSwapWallets(asset, settlement, chainId);

      const resolvedAsset = await this.resolveSourceWallet(asset.source.finId);
      if (!resolvedAsset) return failedSwapOperation(1, `Asset source ${asset.source.finId} cannot be resolved to a custody wallet`);
      const resolvedSettlement = await this.resolveSourceWallet(settlement.source.finId);
      if (!resolvedSettlement) return failedSwapOperation(1, `Settlement source ${settlement.source.finId} cannot be resolved to a custody wallet`);

      const intent = await this.toSwapIntent(operationId, asset, settlement, resolvedAsset.address, resolvedSettlement.address, deadline);

      // both allowances up front — the venue checks them when the legs cross
      await Promise.all([
        this.approveToSwapVenue(resolvedAsset.wallet.signer, intent.give.token, intent.give.amount),
        this.approveToSwapVenue(resolvedSettlement.wallet.signer, intent.take.token, intent.take.amount),
      ]);

      // both mirrored perspectives in parallel: each call resolves only once
      // BOTH legs have crossed, so each side's submission unblocks the other
      const [assetSubmission, settlementSubmission] = await Promise.all([
        this.swapVenue.swap(resolvedAsset.wallet, intent, this.logger),
        this.swapVenue.swap(resolvedSettlement.wallet, mirrored(intent), this.logger),
      ]);
      if (assetSubmission.status === 'failure') {
        return failedSwapOperation(1, assetSubmission.reason);
      }
      if (settlementSubmission.status === 'failure') {
        return failedSwapOperation(1, settlementSubmission.reason);
      }

      // both submissions attest the same executing transaction
      const { transactionId, timestamp } = assetSubmission;
      return successfulSwapOperation(
        swapMovementReceipt(`${transactionId}:${asset.asset.assetId}`, transactionId, operationId, asset, exCtx, timestamp),
        swapMovementReceipt(`${transactionId}:${settlement.asset.assetId}`, transactionId, operationId, settlement, exCtx, timestamp),
      );
    } catch (e) {
      this.logger.error(`Swap (both legs) failed: operationId=${operationId} asset=${asset.asset.assetId} settlement=${settlement.asset.assetId}`, e);
      return failedSwapOperation(1, `${e}`);
    }
  }

  async redeem(
    idempotencyKey: string, nonce: string, source: Source, ast: Asset,
    quantity: string, operationId: string | undefined, signature: Signature,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const amount = parseUnits(quantity, asset.decimals);
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId, ReleaseType.Redeem);

      if (operationId && tokenStandardRegistry.holdModel(asset.tokenStandard) === 'holder-reservation') {
        // The held tokens never reached the escrow wallet — hold() reserved them
        // on the investor's account, so there is nothing to burn from escrow.
        // release(ReleaseType.Redeem) resolves the reservation by operationId and
        // burns from the holder; a redemption delivers to no one, hence the
        // zero destination.
        const result = await standard.release(this.escrowWallet, asset, ZeroAddress, amount, this.logger, opCtx);
        return resultToReceipt(result, ast, "redeem", quantity, source, undefined, exCtx, operationId);
      }

      let wallet: CustodyWallet;
      let burnFromAddress: string;
      if (operationId) {
        wallet = this.escrowWallet;
        burnFromAddress = await wallet.signer.getAddress();
      } else {
        const resolved = await this.resolveSourceWallet(source.finId);
        if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
        wallet = resolved.wallet;
        burnFromAddress = resolved.address;
      }

      const result = await standard.burn(wallet, asset, burnFromAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "redeem", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Redeem failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async hold(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined,
    ast: Asset, quantity: string, signature: Signature, operationId: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      const opCtx = buildOperationContext(ast, signature, exCtx, operationId, deriveReleaseType(signature, destination));
      const result = await standard.hold(wallet, this.escrowWallet, asset, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "hold", quantity, source, destination, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Hold failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity} operationId=${operationId}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination, ast: Asset,
    quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
        ?? ledgerAccountAddress(destination.account, (await this.readProvider.getNetwork()).chainId);
      if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const escrowWallet = this.escrowWallet;
      const amount = parseUnits(quantity, asset.decimals);

      const opCtx = buildOperationContext(ast, undefined, exCtx, operationId);
      const result = await standard.release(escrowWallet, asset, destinationAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "release", quantity, source, destination, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Release failed: asset=${ast.assetId} destination=${destination.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async rollback(
    idempotencyKey: string, source: Source, ast: Asset, quantity: string,
    operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const sourceAddress = await this.resolveAddress(source.finId);
      const escrowWallet = this.escrowWallet;
      const amount = parseUnits(quantity, asset.decimals);

      const opCtx = buildOperationContext(ast, undefined, exCtx, operationId);
      const result = await standard.release(escrowWallet, asset, sourceAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "release", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Rollback failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }
}
