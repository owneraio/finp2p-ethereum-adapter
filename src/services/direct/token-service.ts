import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination,
  Balance, Destination, ExecutionContext, OperationType,
  ReceiptOperation, Signature, Source, TokenService, EscrowService,
  failedReceiptOperation
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import winston from 'winston';
import { parseUnits } from "ethers";
import { TokenOperationResult } from '@owneraio/finp2p-ethereum-token-standard';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { AccountMappingService, AssetStore } from './account-mapping';
import { ESCROW_FIN_ID } from './special-accounts';
import { getAssetFromDb } from './helpers';
import { tokenStandardRegistry } from './token-standards/registry';
import { ERC20_TOKEN_STANDARD, DEFAULT_NEW_ERC20_DECIMALS } from './token-standards/erc20';
import { ERC20Contract } from '@owneraio/finp2p-contracts';
import { buildOperationContext } from './operation-context';

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

export class DirectTokenService implements TokenService, EscrowService {

  constructor(
    readonly logger: winston.Logger,
    readonly custodyProvider: CustodyProvider,
    readonly accountMapping: AccountMappingService,
    readonly assetStore: AssetStore,
  ) {}

  private async resolveAddress(finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) throw new Error(`Cannot resolve address for finId: ${finId}`);
    return address;
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

  private async ensureGas(wallet: CustodyWallet): Promise<void> {
    if (!this.custodyProvider.gasStation) return;
    await this.custodyProvider.gasStation.ensureGas(await wallet.signer.getAddress());
  }

  /**
   * Read-only escrow address. Sourced from the '__escrow__' mapping registered
   * at boot. Falls back to the JIT-resolved wallet's getAddress when the
   * mapping has no ledger field.
   */
  private async getEscrowAddress(): Promise<string> {
    const mapped = await this.accountMapping.resolveAccount(ESCROW_FIN_ID);
    if (mapped) return mapped;
    return (await this.getEscrowWallet()).signer.getAddress();
  }

  /**
   * JIT-resolved escrow signing wallet. Reads the custodyAccountId from the
   * '__escrow__' mapping and constructs the wallet via
   * `CustodyProvider.createWalletForCustodyId`. Falls back to the provider's
   * pre-constructed `escrow` (always present per the interface).
   */
  private async getEscrowWallet(): Promise<CustodyWallet> {
    const full = await this.accountMapping.resolveFullAccount?.(ESCROW_FIN_ID);
    const custodyId = full?.custodyAccountId;
    if (custodyId && this.custodyProvider.createWalletForCustodyId) {
      return this.custodyProvider.createWalletForCustodyId(custodyId);
    }
    return this.custodyProvider.escrow;
  }

  async createAsset(
    idempotencyKey: string, assetId: string, assetBind: AssetBind | undefined,
    assetMetadata: any, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined,
  ): Promise<AssetCreationStatus> {
    const tokenStandard = ERC20_TOKEN_STANDARD;
    const standard = tokenStandardRegistry.resolve(tokenStandard);

    const { chainId } = await this.custodyProvider.rpcProvider.getNetwork();
    const defaultNetwork = `eip155:${chainId}`;

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const wallet = this.custodyProvider.issuer;
      const symbol = "OWNERA"; // TODO: align with product team which metadata fields to use for token name/symbol/decimals
      const result = await standard.deploy(wallet, assetName ?? "OWNERACOIN", symbol, DEFAULT_NEW_ERC20_DECIMALS, this.logger);
      await this.assetStore.saveAsset({
        contract_address: result.contractAddress,
        decimals: result.decimals,
        token_standard: result.tokenStandard,
        id: assetId,
      });
      await this.custodyProvider.onAssetRegistered?.(result.contractAddress, symbol);

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: defaultNetwork, tokenId: result.contractAddress, standard: tokenStandard }, reference: undefined }
      };
    } else {
      const tokenAddress = assetBind.tokenIdentifier.tokenId;
      const wallet = this.custodyProvider.issuer;
      const erc20 = new ERC20Contract(wallet.provider, wallet.signer, tokenAddress, this.logger);
      const decimals = Number(await erc20.decimals());
      await this.assetStore.saveAsset({
        contract_address: tokenAddress,
        decimals,
        token_standard: tokenStandard,
        id: assetId,
      });

      await this.custodyProvider.onAssetRegistered?.(tokenAddress);

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network: assetBind.tokenIdentifier.network || defaultNetwork, tokenId: tokenAddress, standard: tokenStandard }, reference: undefined }
      };
    }
  }

  async getBalance(ast: Asset, finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) return "0";
    const asset = await getAssetFromDb(this.assetStore, ast.assetId);
    const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
    return standard.balanceOf(
      this.custodyProvider.issuer.provider, this.custodyProvider.issuer.signer,
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const wallet = this.custodyProvider.issuer;
      const address = await this.resolveAddress(toFinId);
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(wallet);
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(wallet);
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const escrowAddress = await this.getEscrowAddress();
      const wallet = this.custodyProvider.issuer;
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(wallet);
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
      const result = await standard.burn(wallet, asset, escrowAddress, amount, this.logger, opCtx);
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(wallet);
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
      const escrowWallet = await this.getEscrowWallet();
      const result = await standard.hold(wallet, escrowWallet, asset, amount, this.logger, opCtx);
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const destinationAddress = await this.accountMapping.resolveAccount(destination.finId)
        ?? destination.account?.address;
      if (!destinationAddress) throw new Error(`Cannot resolve address for finId: ${destination.finId}`);
      const escrowWallet = await this.getEscrowWallet();
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(escrowWallet);
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
      const asset = await getAssetFromDb(this.assetStore, ast.assetId);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const sourceAddress = await this.resolveAddress(source.finId);
      const escrowWallet = await this.getEscrowWallet();
      const amount = parseUnits(quantity, asset.decimals);

      await this.ensureGas(escrowWallet);
      const opCtx = buildOperationContext(ast, undefined, exCtx, operationId);
      const result = await standard.release(escrowWallet, asset, sourceAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "release", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Rollback failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }
}
