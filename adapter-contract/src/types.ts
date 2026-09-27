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

/** CAIP-2 chain id: `eip155:11155111`, `stellar:testnet`, `solana:devnet`. */
export type LedgerId = string;

/**
 * A wallet with a provider and signer, used for signing and submitting transactions.
 * Structurally mirrors CustodyWallet; kept as its own type so plugins never
 * import adapter runtime modules. The default wallet of every TokenStandard.
 */
export interface TokenWallet {
  provider: Provider;
  signer: Signer;
}

/**
 * Whoever can authorise an operation for an address on a ledger that is not
 * signed the ethers way. Deliberately almost empty: what authorising takes is
 * the ledger's business, and a plugin narrows this to the shape it needs by
 * naming it as its wallet type parameter.
 */
export interface LedgerWallet {
  readonly address: string;
}

/**
 * A wallet that signs arbitrary bytes. Every ledger whose transactions are
 * signed payloads rather than ethers transaction objects (Stellar, Solana)
 * needs exactly this and nothing more.
 */
export interface MessageSigner extends LedgerWallet {
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export function signsMessages(wallet: LedgerWallet): wallet is MessageSigner {
  return typeof (wallet as Partial<MessageSigner>).sign === 'function';
}

/**
 * Stored asset data from the DB, used to resolve the token standard.
 */
export interface AssetRecord {
  /**
   * The contract address on EVM. On other ledgers, the ledger-native token id:
   * `CODE:ISSUER` on Stellar, `native` for the ledger's own coin.
   */
  contractAddress: string;
  decimals: number;
  tokenStandard: string;
  /** Absent means the host's configured chain, which is every record written before ledgers existed here. */
  ledger?: LedgerId;
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

/**
 * Host-supplied asset lookup, injected into plugin constructors that need to
 * resolve assets themselves (e.g. plan-approval flows). The host adapts its
 * storage into this shape; undefined means the asset is not kept by this host.
 */
export type AssetResolver = (assetId: string) => Promise<AssetRecord | undefined>;
