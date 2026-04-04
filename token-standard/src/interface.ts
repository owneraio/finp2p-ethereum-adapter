import { ContractTransactionResponse, Provider, Signer } from 'ethers';
import { TokenWallet, AssetRecord, DeployResult, Logger, OperationContext } from './types';

/**
 * Token standard implementation for direct-mode operations.
 *
 * Each mutating method returns a ContractTransactionResponse that the adapter
 * awaits via tx.wait(). The adapter owns gas funding, receipt shaping,
 * logging, and error handling — the standard only constructs the on-chain call.
 *
 * The optional OperationContext mirrors the on-chain OperationParams struct,
 * carrying business semantics (leg, phase, primaryType) so standards can
 * vary behavior — e.g. REPO flows use Phase to distinguish initiation from closure.
 *
 * Implement this interface in a plugin package and register it with the
 * adapter's tokenStandardRegistry at bootstrap.
 */
export interface TokenStandard {
  /**
   * Deploy a new token contract. Returns the contract address and metadata.
   * Called when createAsset has no tokenIdentifier binding.
   */
  deploy(
    wallet: TokenWallet,
    name: string,
    symbol: string,
    decimals: number,
    logger: Logger,
  ): Promise<DeployResult>;

  /**
   * Query the balance of an address for the given asset.
   */
  balanceOf(
    provider: Provider,
    signer: Signer,
    asset: AssetRecord,
    address: string,
    logger: Logger,
  ): Promise<bigint>;

  /**
   * Mint tokens to an address.
   */
  mint(
    wallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<ContractTransactionResponse>;

  /**
   * Transfer tokens from the signer's address to another address.
   */
  transfer(
    wallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<ContractTransactionResponse>;

  /**
   * Burn tokens from a given address (operator burn).
   */
  burn(
    wallet: TokenWallet,
    asset: AssetRecord,
    from: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<ContractTransactionResponse>;

  /**
   * Hold (escrow) tokens for a pending settlement.
   *
   * The sourceWallet signs the transaction. The escrowWallet is provided
   * so the standard can decide where funds go:
   * - ERC20: trivializes to transfer(sourceWallet → escrowAddress)
   * - REPO standards may use Phase to vary behavior (INITIATE vs CLOSE)
   */
  hold(
    sourceWallet: TokenWallet,
    escrowWallet: TokenWallet,
    asset: AssetRecord,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<ContractTransactionResponse>;

  /**
   * Release held tokens to a destination address.
   *
   * The escrowWallet signs the transaction:
   * - ERC20: trivializes to transfer(escrowWallet → destinationAddress)
   * - REPO standards may use Phase to trigger settlement closure
   */
  release(
    escrowWallet: TokenWallet,
    asset: AssetRecord,
    to: string,
    amount: bigint,
    logger: Logger,
    opCtx?: OperationContext,
  ): Promise<ContractTransactionResponse>;
}
