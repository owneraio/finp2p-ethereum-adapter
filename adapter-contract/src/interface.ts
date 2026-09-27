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
 * `W` is what a write is authorised with. It defaults to the ethers-shaped
 * TokenWallet, so every EVM plugin implements `TokenStandard` exactly as
 * before. A plugin for a ledger that signs bytes rather than ethers
 * transactions implements `TokenStandard<MessageSigner>`; one instance is
 * built per ledger, with its transport supplied at construction, the same
 * way the EVM plugins receive their provider. The ethers `provider` and
 * `signer` on the read methods are the configured chain's and are ignored by
 * such a plugin.
 *
 * Implement this interface in a plugin package; the adapter registers it in
 * its tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard<W = TokenWallet> {
  deploy(wallet: W, name: string, symbol: string, decimals: number, logger: Logger): Promise<DeployResult>;
  decimals(provider: Provider, tokenAddress: string, logger: Logger): Promise<number>;
  balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: Logger): Promise<string>;
  mint(wallet: W, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  transfer(wallet: W, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  burn(wallet: W, asset: AssetRecord, from: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  hold(sourceWallet: W, escrowWallet: W, asset: AssetRecord, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
  release(escrowWallet: W, asset: AssetRecord, to: string, amount: bigint, logger: Logger, opCtx?: OperationContext): Promise<TokenOperationResult>;
}
