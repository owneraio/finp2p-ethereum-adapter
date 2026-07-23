import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination,
  Balance, Destination, ExecutionContext, HealthService, OperationType,
  ReceiptOperation, Signature, Source, TokenService, EscrowService,
  failedReceiptOperation, failedAssetCreation
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import winston from 'winston';
import { parseUnits, Provider, Signer, Wallet } from "ethers";
import { AssetRecord, TokenOperationResult } from '@owneraio/finp2p-ethereum-adapter-contract';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { AccountResolver, AssetStore } from "../accounts";
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';
import { TokenStandardName as ERC20_TOKEN_STANDARD, DEFAULT_NEW_ERC20_DECIMALS } from '@owneraio/finp2p-ethereum-erc20-plugin';
import { buildOperationContext } from "../operations";
import { ContractEscrow } from './contract-escrow';

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
    // when set (ESCROW_PROVIDER=contract), holds go to the standalone
    // FinP2PEscrow contract instead of the custody escrow wallet
    readonly contractEscrow?: ContractEscrow,
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
      this.logger.error(`createAsset: assetId=${assetId} requested token standard '${requestedStandard}' is not registered; available: ${tokenStandardRegistry.availableStandards.join(', ')}`);
    }
    const standard = tokenStandardRegistry.resolve(requestedStandard);
    this.logger.info(`createAsset: assetId=${assetId} token standard '${requestedStandard}'${explicitStandard === undefined ? ' (defaulted, none requested)' : ''} resolved to ${standard.constructor.name}`);

    const { chainId } = await this.readProvider.getNetwork();
    const defaultNetwork = `eip155:${chainId}`;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
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
      const tokenAddress = assetBind.tokenIdentifier.tokenId;
      this.logger.info(`createAsset: bind path — assetId=${assetId} standard=${requestedStandard} tokenAddress=${tokenAddress} network=${assetBind.tokenIdentifier.network ?? defaultNetwork}`);

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
        result: { ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: assetBind.tokenIdentifier.network || defaultNetwork, tokenId: tokenAddress, standard: requestedStandard }, reference: undefined }
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
    idempotencyKey: string, ast: Asset, toFinId: string, quantity: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const wallet = this.issuerWallet;
      if (!wallet) return failedReceiptOperation(1, 'ASSET_ISSUER_PRIVATE_KEY is not set — issuance is disabled');
      const address = await this.resolveAddress(toFinId);
      const amount = parseUnits(quantity, asset.decimals);

      const result = await standard.mint(wallet, asset, address, amount, this.logger);
      const dest: Destination = { finId: toFinId };
      return resultToReceipt(result, ast, "issue", quantity, dest, dest, exCtx, undefined);
    } catch (e) {
      this.logger.error(`Issue failed: asset=${ast.assetId} to=${toFinId} quantity=${quantity}`, e);
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
        ?? destination.account?.address;
      if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const opCtx = buildOperationContext(ast, signature, exCtx);
      const result = await standard.transfer(wallet, asset, destinationAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "transfer", quantity, source, destination, exCtx, undefined);
    } catch (e) {
      this.logger.error(`Transfer failed: asset=${ast.assetId} from=${source.finId} to=${destination.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async redeem(
    idempotencyKey: string, nonce: string, sourceFinId: string, ast: Asset,
    quantity: string, operationId: string | undefined, signature: Signature,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await this.assetRecord(ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);

      if (operationId && this.contractEscrow) {
        const expectedAmount = parseUnits(quantity, asset.decimals);
        const holdSourceAddress = await this.resolveAddress(sourceFinId);
        const result = await this.contractEscrow.releaseAndBurn(operationId, {
          token: asset.contractAddress, amount: expectedAmount, source: holdSourceAddress
        });
        return resultToReceipt(result, ast, "redeem", quantity, { finId: sourceFinId }, undefined, exCtx, operationId);
      }

      let wallet: CustodyWallet;
      let burnFromAddress: string;
      if (operationId) {
        wallet = this.escrowWallet;
        burnFromAddress = await wallet.signer.getAddress();
      } else {
        const resolved = await this.resolveSourceWallet(sourceFinId);
        if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
        wallet = resolved.wallet;
        burnFromAddress = resolved.address;
      }
      const amount = parseUnits(quantity, asset.decimals);

      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
      const result = await standard.burn(wallet, asset, burnFromAddress, amount, this.logger, opCtx);
      const source: Source = { finId: sourceFinId };
      return resultToReceipt(result, ast, "redeem", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Redeem failed: asset=${ast.assetId} source=${sourceFinId} quantity=${quantity}`, e);
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

      if (this.contractEscrow) {
        // a requested destination that cannot be resolved must fail loudly:
        // silently falling back to an unpinned (destinationless) hold would
        // drop the destination-pinning guarantee the caller asked for
        let destinationAddress: string | undefined;
        if (destination?.finId) {
          destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
            ?? destination.account?.address;
          if (!destinationAddress) throw new Error(`Cannot resolve address for destination finId: ${destination.finId}`);
        }
        const result = await this.contractEscrow.hold(
          wallet, resolved.address, destinationAddress, asset.contractAddress, operationId, amount);
        return resultToReceipt(result, ast, "hold", quantity, source, destination, exCtx, operationId);
      }
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
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
        ?? destination.account?.address;
      if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const escrowWallet = this.escrowWallet;
      const amount = parseUnits(quantity, asset.decimals);

      if (this.contractEscrow) {
        const holdSourceAddress = await this.resolveAddress(source.finId);
        const result = await this.contractEscrow.release(operationId, destinationAddress, {
          token: asset.contractAddress, amount, source: holdSourceAddress
        });
        return resultToReceipt(result, ast, "release", quantity, source, destination, exCtx, operationId);
      }
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

      if (this.contractEscrow) {
        const result = await this.contractEscrow.rollback(operationId, {
          token: asset.contractAddress, amount, source: sourceAddress
        });
        return resultToReceipt(result, ast, "release", quantity, source, undefined, exCtx, operationId);
      }
      const opCtx = buildOperationContext(ast, undefined, exCtx, operationId);
      const result = await standard.release(escrowWallet, asset, sourceAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "release", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Rollback failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }
}
