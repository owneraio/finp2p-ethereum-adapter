import { Provider, Signer } from 'ethers';
import { TokenWallet, AssetRecord, DeployResult, Logger, OperationContext, TokenOperationResult } from './types';

/**
 * Token standard implementation for direct-mode operations.
 *
 * Each mutating method returns a TokenOperationResult:
 * - success with transactionId: on-chain tx was submitted and confirmed
 * - success without transactionId: no on-chain tx needed (e.g. validation-only hold)
 * - failure: operation failed with a reason
 *
 * The adapter owns gas funding, receipt shaping, logging, and error handling.
 * The standard owns on-chain call construction and tx.wait().
 *
 * The optional OperationContext mirrors the on-chain OperationParams struct,
 * carrying business semantics (leg, phase, primaryType) so standards can
 * vary behavior — e.g. REPO flows use Phase to distinguish initiation from closure.
 *
 * Implement this interface in a plugin package and register it with the
 * adapter's tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard {
  deploy(
    wallet: TokenWallet,
    name: string,
    symbol: string,
    decimals: number,
    logger: Logger,
  ): Promise<DeployResult>;

  balanceOf(
    provider: Provider,
    signer: Signer,
    asset: AssetRecord,
    address: string,
    logger: Logger,
  ): Promise<string>;

  mint(
    wallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<TokenOperationResult>;

  transfer(
    wallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<TokenOperationResult>;

  burn(
    wallet: TokenWallet,
    asset: AssetRecord,
    from: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<TokenOperationResult>;

  hold(
    sourceWallet: TokenWallet,
    escrowWallet: TokenWallet,
    asset: AssetRecord,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<TokenOperationResult>;

  release(
    escrowWallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<TokenOperationResult>;
}
