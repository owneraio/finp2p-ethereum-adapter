import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier,
  Balance, Destination, ExecutionContext, FinIdAccount, OperationType,
  ReceiptOperation, Signature, Source, TokenService, EscrowService,
  failedReceiptOperation
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import winston from 'winston';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits } from "ethers";
import { TokenOperationResult } from '@owneraio/finp2p-ethereum-token-standard';
import { CustodyProvider, CustodyWallet } from './custody-provider';
import { AccountMappingService } from './account-mapping';
import { getAssetFromDb, fundGasIfNeeded } from './helpers';
import { tokenStandardRegistry } from './token-standards/registry';
import { ERC20_TOKEN_STANDARD } from './token-standards/erc20';
import { buildOperationContext } from './operation-context';

function resultToReceipt(
  result: TokenOperationResult, ast: Asset, operationType: OperationType, quantity: string,
  source: Source | { account: FinIdAccount; finId: string },
  destination: Destination | { account: FinIdAccount; finId: string } | undefined,
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
  ) {}

  private async resolveAddress(finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) throw new Error(`Cannot resolve address for finId: ${finId}`);
    return address;
  }

  private async resolveDestinationAddress(destination: Destination): Promise<string> {
    if (destination.account.type === 'crypto') return destination.account.address;
    return this.resolveAddress(destination.finId);
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

  private async fundGas(wallet: CustodyWallet): Promise<void> {
    return fundGasIfNeeded(this.logger, this.custodyProvider.gasStation, wallet);
  }

  async createAsset(
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined,
    assetMetadata: any, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined
  ): Promise<AssetCreationStatus> {
    const tokenStandard = assetIdentifier?.value
      ? (tokenStandardRegistry.has(assetIdentifier.value) ? assetIdentifier.value : ERC20_TOKEN_STANDARD)
      : ERC20_TOKEN_STANDARD;
    const standard = tokenStandardRegistry.resolve(tokenStandard);

    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const wallet = this.custodyProvider.issuer;
      const symbol = assetIdentifier?.value ?? "OWNERA";
      const result = await standard.deploy(wallet, assetName ?? "OWNERACOIN", symbol, 6, this.logger);
      await workflows.saveAsset({
        contract_address: result.contractAddress,
        decimals: result.decimals,
        token_standard: result.tokenStandard as any,
        id: asset.assetId,
        type: asset.assetType,
      });
      await this.custodyProvider.onAssetRegistered?.(result.contractAddress, symbol);

      return {
        operation: "createAsset",
        type: "success",
        result: { tokenId: result.contractAddress, reference: undefined }
      };
    } else {
      const tokenAddress = assetBind.tokenIdentifier.tokenId;
      await workflows.saveAsset({
        contract_address: tokenAddress,
        decimals: 6,
        token_standard: tokenStandard as any,
        id: asset.assetId,
        type: asset.assetType,
      });

      try {
        await this.custodyProvider.onAssetRegistered?.(tokenAddress);
      } catch (e) {
        this.logger.warn(`Asset registration failed (may already exist): ${e}`);
      }

      return {
        operation: "createAsset",
        type: "success",
        result: { tokenId: tokenAddress, reference: undefined }
      };
    }
  }

  async getBalance(ast: Asset, finId: string): Promise<string> {
    const address = await this.accountMapping.resolveAccount(finId);
    if (address === undefined) return "0";
    const asset = await getAssetFromDb(ast);
    const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
    const balance = await standard.balanceOf(
      this.custodyProvider.issuer.provider, this.custodyProvider.issuer.signer,
      asset, address, this.logger,
    );
    this.logger.debug(`getBalance: assetId=${ast.assetId} finId=${finId} tokenStandard=${asset.tokenStandard} address=${address} balance=${balance}`);
    return balance;
  }

  async balance(ast: Asset, finId: string): Promise<Balance> {
    const b = await this.getBalance(ast, finId);
    return { current: b, available: b, held: "0" };
  }

  async issue(
    idempotencyKey: string, ast: Asset, to: FinIdAccount, quantity: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const wallet = this.custodyProvider.issuer;
      const address = await this.resolveAddress(to.finId);
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(wallet);
      const result = await standard.mint(wallet, asset, address, amount, this.logger);
      return resultToReceipt(result, ast, "issue", quantity,
        { account: to, finId: to.finId }, { account: to, finId: to.finId },
        exCtx, undefined);
    } catch (e) {
      this.logger.error(`Issue failed: asset=${ast.assetId} to=${to.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async transfer(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    ast: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(wallet);
      const destinationAddress = await this.resolveDestinationAddress(destination);
      const opCtx = buildOperationContext(ast, signature, exCtx);
      const result = await standard.transfer(wallet, asset, destinationAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "transfer", quantity, source, destination, exCtx, undefined);
    } catch (e) {
      this.logger.error(`Transfer failed: asset=${ast.assetId} from=${source.finId} to=${destination.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }

  async redeem(
    idempotencyKey: string, nonce: string, source: FinIdAccount, ast: Asset,
    quantity: string, operationId: string | undefined, signature: Signature,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const escrowAddress = await this.custodyProvider.escrow.signer.getAddress();
      const wallet = this.custodyProvider.issuer;
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(wallet);
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
      const result = await standard.burn(wallet, asset, escrowAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "redeem", quantity,
        { account: source, finId: source.finId }, undefined, exCtx, operationId);
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
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const resolved = await this.resolveSourceWallet(source.finId);
      if (!resolved) return failedReceiptOperation(1, 'Source address cannot be resolved to a custody wallet');
      const { wallet } = resolved;
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(wallet);
      const opCtx = buildOperationContext(ast, signature, exCtx, operationId);
      const result = await standard.hold(wallet, this.custodyProvider.escrow, asset, amount, this.logger, opCtx);
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
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const destinationAddress = await this.resolveDestinationAddress(destination);
      const escrowWallet = this.custodyProvider.escrow;
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(escrowWallet);
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
      const asset = await getAssetFromDb(ast);
      const standard = tokenStandardRegistry.resolve(asset.tokenStandard);
      const sourceAddress = await this.resolveAddress(source.finId);
      const escrowWallet = this.custodyProvider.escrow;
      const amount = parseUnits(quantity, asset.decimals);

      await this.fundGas(escrowWallet);
      const opCtx = buildOperationContext(ast, undefined, exCtx, operationId);
      const result = await standard.release(escrowWallet, asset, sourceAddress, amount, this.logger, opCtx);
      return resultToReceipt(result, ast, "release", quantity, source, undefined, exCtx, operationId);
    } catch (e) {
      this.logger.error(`Rollback failed: asset=${ast.assetId} source=${source.finId} quantity=${quantity}`, e);
      return failedReceiptOperation(1, `${e}`);
    }
  }
}
