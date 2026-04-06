import { Provider, Signer } from 'ethers';

/**
 * Minimal logger interface. Structurally compatible with winston, console, or any logger.
 */
export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * A wallet with a provider and signer, used for signing and submitting transactions.
 * Mirrors the adapter's CustodyWallet without coupling to the adapter package.
 */
export interface TokenWallet {
  provider: Provider;
  signer: Signer;
}

/**
 * Stored asset data from the DB, used to resolve the token standard.
 */
export interface AssetRecord {
  contractAddress: string;
  decimals: number;
  tokenStandard: string;
}

/**
 * Result of a token standard operation (mint, transfer, burn, hold, release).
 *
 * - success: transactionId is always present — standards that don't produce
 *   an on-chain tx must generate a synthetic ID themselves
 * - failure: operation failed with a reason
 */
export type TokenOperationResult =
  | { status: 'success'; transactionId: string; timestamp: number }
  | { status: 'failure'; reason: string };

export const successfulTokenOp = (transactionId: string, timestamp: number): TokenOperationResult =>
  ({ status: 'success', transactionId, timestamp });

export const failedTokenOp = (reason: string): TokenOperationResult =>
  ({ status: 'failure', reason });

/**
 * Result of deploying a new token contract.
 */
export interface DeployResult {
  contractAddress: string;
  decimals: number;
  tokenStandard: string;
}

/**
 * Operation context — mirrors the on-chain OperationParams struct.
 * Carries the business semantics of an operation so token standards
 * can vary behavior based on leg, phase, and primary type.
 *
 * For REPO/Loan flows, Phase is critical:
 * - INITIATE: collateral pledged, cash lent
 * - CLOSE: collateral returned, cash + rebate repaid
 */

export enum LegType {
  Asset = 0,
  Settlement = 1,
}

export enum PrimaryType {
  PrimarySale = 0,
  Buying = 1,
  Selling = 2,
  Redemption = 3,
  Transfer = 4,
  PrivateOffer = 5,
  Loan = 6,
}

export enum Phase {
  Initiate = 0,
  Close = 1,
}

export enum ReleaseType {
  Release = 0,
  Redeem = 1,
}

export interface OperationContext {
  leg: LegType;
  phase: Phase;
  primaryType: PrimaryType;
  operationId?: string;
  releaseType: ReleaseType;
}

/**
 * Compiled contract artifact — ABI + bytecode for on-chain deployment.
 * Token standard packages include these so `deploy()` can use them
 * without depending on a separate contracts package.
 */
export interface ContractArtifact {
  abi: any[];
  bytecode: string;
}

/**
 * A complete token standard package: off-chain implementation + on-chain artifacts.
 *
 * Plugin packages export this so the adapter can both:
 * - register the off-chain standard for runtime operations
 * - access the contract artifacts for deployment
 *
 * Example:
 *   import { erc20Standard } from '@owneraio/finp2p-ethereum-adapter';
 *   // erc20Standard.standard  → TokenStandard implementation
 *   // erc20Standard.artifacts → { token: { abi, bytecode } }
 */
export interface TokenStandardPackage {
  /** Unique key used in the token_standard registry and DB field. */
  name: string;

  /** Off-chain implementation: deploy, balanceOf, mint, transfer, burn, hold, release. */
  standard: import('./interface').TokenStandard;

  /**
   * On-chain contract artifacts keyed by role.
   * The 'token' key is the primary token contract.
   * Additional keys are standard-specific (e.g. 'factory', 'escrow', 'priceOracle').
   */
  artifacts?: Record<string, ContractArtifact>;
}
