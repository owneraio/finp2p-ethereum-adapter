import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination,
  Balance, Destination, ExecutionContext, FinIdAccount, OperationType,
  ReceiptOperation, Signature, Source, TokenService, EscrowService,
  failedReceiptOperation
} from '@owneraio/finp2p-adapter-models';
import winston from 'winston';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { parseUnits, formatUnits, TransactionReceipt } from "ethers";
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import { CustodyProvider } from './custody-provider';
import { AccountMappingService } from './account-mapping';

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType });
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`);
  return asset;
}

function buildReceiptOperation(
  receipt: TransactionReceipt, asset: Asset, operationType: OperationType, quantity: string,
  source: Source | { account: FinIdAccount; finId: string },
  destination: Destination | { account: FinIdAccount; finId: string } | undefined,
  exCtx: ExecutionContext | undefined, operationId: string | undefined, blockTimestamp: number
): ReceiptOperation {
  return {
    operation: "receipt",
    type: "success",
    receipt: {
      id: receipt.hash,
      asset,
      source,
      destination,
      operationType,
      proof: undefined,
      quantity,
      timestamp: blockTimestamp,
      tradeDetails: { executionContext: exCtx },
      transactionDetails: { operationId, transactionId: receipt.hash }
    }
  };
}

export class DirectTokenService implements TokenService, EscrowService {

  constructor(
    readonly logger: winston.Logger,
    readonly custodyProvider: CustodyProvider,
    readonly accountMapping: AccountMappingService,
  ) {}

  private async resolveAddress(acc: Source | Destination): Promise<string> {
    if (acc.ledgerAccount) return acc.ledgerAccount.address;
    if (acc.account.type === 'crypto') return acc.account.address;

    const address = await this.accountMapping.resolveAccount(acc.finId);
    if (address === undefined) throw new Error(`Cannot resolve address for finId: ${acc.finId}`);
    return address;
  }

  async createAsset(
    idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined,
    assetMetadata: any, assetName: string | undefined, issuerId: string | undefined,
    assetDenomination: AssetDenomination | undefined
  ): Promise<AssetCreationStatus> {
    const decimals = 6;

    if (assetBind === undefined) {
      const { provider, signer } = this.custodyProvider.issuer;
      await this.custodyProvider.fundGasIfNeeded?.(this.custodyProvider.issuer);
      const cm = new ContractsManager(provider, signer, this.logger);
      const symbol = "OWNERA";
      const erc20 = await cm.deployERC20Detached(
        assetName ?? "OWNERACOIN",
        symbol,
        decimals,
        await signer.getAddress()
      );
      await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });
      await this.custodyProvider.onAssetRegistered?.(erc20, symbol);

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { network: 'ethereum', tokenId: erc20, standard: 'ERC20' }, reference: undefined }
      };
    } else {
      const tokenAddress = assetBind.tokenIdentifier.tokenId;
      await workflows.saveAsset({ contract_address: tokenAddress, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType });

      try {
        await this.custodyProvider.onAssetRegistered?.(tokenAddress);
      } catch (e) {
        this.logger.warn(`Asset registration failed (may already exist): ${e}`);
      }

      return {
        operation: "createAsset",
        type: "success",
        result: { ledgerIdentifier: { network: 'ethereum', tokenId: tokenAddress, standard: 'ERC20' }, reference: undefined }
      };
    }
  }

  async getBalance(ast: Asset, finId: string): Promise<string> {
    const asset = await getAssetFromDb(ast);
    const address = await this.resolveAddress({ finId, account: { type: 'finId', finId }});
    const c = new ERC20Contract(this.custodyProvider.issuer.provider, this.custodyProvider.issuer.signer, asset.contract_address, this.logger);
    return formatUnits(await c.balanceOf(address), asset.decimals);
  }

  async balance(ast: Asset, finId: string): Promise<Balance> {
    const b = await this.getBalance(ast, finId);
    return { current: b, available: b, held: "0" };
  }

  async issue(
    idempotencyKey: string, ast: Asset, to: Destination, quantity: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast);
    const wallet = this.custodyProvider.issuer;
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const address = await this.resolveAddress(to);
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.mint(address, amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    const toAccount: FinIdAccount = { type: 'finId', finId: to.finId };
    return buildReceiptOperation(
      receipt, ast, "issue", quantity,
      { account: toAccount, finId: to.finId }, to,
      exCtx, undefined, block.timestamp
    );
  }

  async doesSupportCrosschainTransfer(_sourceAsset: Asset, _destinationAsset: Asset): Promise<boolean> {
    return false;
  }

  async transfer(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination,
    sourceAsset: Asset, destinationAsset: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(sourceAsset);
    const sourceAddress = await this.resolveAddress(source);
    const wallet = await this.custodyProvider.resolveWallet(sourceAddress);
    if (wallet === undefined) throw new Error('Source address cannot be resolved to a custody wallet');
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.transfer(await this.resolveAddress(destination), amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    return buildReceiptOperation(receipt, sourceAsset, "transfer", quantity, source, destination, exCtx, undefined, block.timestamp);
  }

  async redeem(
    idempotencyKey: string, nonce: string, source: FinIdAccount, ast: Asset,
    quantity: string, operationId: string | undefined, signature: Signature,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast);
    const escrowAddress = await this.custodyProvider.escrow.signer.getAddress();
    const wallet = this.custodyProvider.issuer;
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.burn(escrowAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    return buildReceiptOperation(
      receipt, ast, "redeem", quantity,
      { account: source, finId: source.finId }, undefined,
      exCtx, operationId, block.timestamp
    );
  }

  async hold(
    idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined,
    ast: Asset, quantity: string, signature: Signature, operationId: string,
    exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast);
    const sourceAddress = await this.resolveAddress(source);
    const wallet = await this.custodyProvider.resolveWallet(sourceAddress);
    if (wallet === undefined) throw new Error('Source address cannot be resolved to a custody wallet');
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.transfer(await this.custodyProvider.escrow.signer.getAddress(), amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    return buildReceiptOperation(receipt, ast, "hold", quantity, source, destination, exCtx, undefined, block.timestamp);
  }

  async release(
    idempotencyKey: string, source: Source, destination: Destination, ast: Asset,
    quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast);
    const destinationAddress = await this.resolveAddress(destination);
    const wallet = this.custodyProvider.escrow;
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.transfer(destinationAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    return buildReceiptOperation(receipt, ast, "release", quantity, source, destination, exCtx, undefined, block.timestamp);
  }

  async rollback(
    idempotencyKey: string, source: Source, ast: Asset, quantity: string,
    operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast);
    const sourceAddress = await this.resolveAddress(source);
    const wallet = this.custodyProvider.escrow;
    const amount = parseUnits(quantity, asset.decimals);

    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, this.logger);
    await this.custodyProvider.fundGasIfNeeded?.(wallet);
    const tx = await c.transfer(sourceAddress, amount);
    const receipt = await tx.wait();
    if (receipt === null) return failedReceiptOperation(1, "receipt is null");

    const block = await receipt.getBlock();
    if (block === null) return failedReceiptOperation(1, "block is null");
    return buildReceiptOperation(receipt, ast, "release", quantity, source, undefined, exCtx, undefined, block.timestamp);
  }
}
