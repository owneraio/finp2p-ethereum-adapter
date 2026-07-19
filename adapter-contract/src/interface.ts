import type { Provider, Signer } from 'ethers';
import type { TokenWallet, AssetRecord, DeployResult, Logger, OperationContext, TokenOperationResult } from './types';

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
 * Implement this interface in a plugin package; the adapter registers it in
 * its tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard {
  deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number, logger: Logger): Promise<DeployResult>;
  balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: Logger): Promise<string>;
  mint(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  transfer(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  burn(wallet: TokenWallet, asset: AssetRecord, from: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  hold(sourceWallet: TokenWallet, escrowWallet: TokenWallet, asset: AssetRecord, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  release(escrowWallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
}
