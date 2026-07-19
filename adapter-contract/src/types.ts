import type { Provider, Signer } from 'ethers';

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
 * Structurally mirrors CustodyWallet; kept as its own type so plugins never
 * import adapter runtime modules.
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
  Move = 7,
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
