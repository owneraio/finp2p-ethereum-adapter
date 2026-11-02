import type { Provider, Signer } from 'ethers';
import type { TokenWallet, AssetRecord, DeployOptions, DeployResult, Logger, OperationContext, TokenOperationResult } from './types';

/**
 * Token standard implementation for direct-mode operations.
 *
 * Each mutating method returns a TokenOperationResult:
 * - success: transactionId is always present — standards that don't produce
 *   an on-chain tx must synthesize one (e.g. a validation-only hold)
 * - failure: operation failed with a reason
 *
 * The adapter owns gas funding, receipt shaping, logging, and error handling.
 * The standard owns on-chain call construction and tx.wait().
 *
 * The optional OperationContext mirrors the on-chain OperationParams struct,
 * carrying business semantics (leg, phase, primaryType) so standards can
 * vary behavior — e.g. REPO flows use Phase to distinguish initiation from closure.
 *
 * deploy runs when an asset is created without an existing token. It may run
 * any number of transactions, and options.context carries the creation
 * request, so a standard can build a configured asset from the request's
 * metadata. A deploy that receives a context MUST NOT create a second asset
 * for an assetId, whatever the idempotencyKey: it returns the asset already
 * created for that assetId, and resumes a creation that stopped part-way (the
 * host replays unfinished creations after a restart). Return only once the asset is
 * fully set up; throw to fail. name and symbol are advisory: a standard whose
 * on-chain identifiers must be unique derives them from the context instead.
 *
 * Implement this interface in a plugin package; the adapter registers it in
 * its tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard {
  deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number, logger: Logger, options?: DeployOptions): Promise<DeployResult>;
  decimals(provider: Provider, tokenAddress: string, logger: Logger): Promise<number>;
  balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: Logger): Promise<string>;
  mint(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  transfer(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  burn(wallet: TokenWallet, asset: AssetRecord, from: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  hold(sourceWallet: TokenWallet, escrowWallet: TokenWallet, asset: AssetRecord, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  release(escrowWallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
}
