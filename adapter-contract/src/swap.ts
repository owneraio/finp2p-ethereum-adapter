import type { Provider, TypedDataDomain, TypedDataField } from 'ethers';
import type { TokenWallet, Logger } from './types';

export interface SwapSide {
  token: string;
  party: string;
  amount: bigint;
}

export interface SwapPermit {
  signature: string;
  nonce: bigint;
  deadline: number;
}

export interface SwapIntent {
  operationId: string;
  give: SwapSide;
  take: SwapSide;
  deadline?: number;
  permit?: SwapPermit;
}

export const mirrored = ({ permit, ...intent }: SwapIntent): SwapIntent =>
  ({ ...intent, give: intent.take, take: intent.give });

export type SwapSubmission =
  | { status: 'executed'; transactionId: string; blockNumber: number; timestamp: number }
  | { status: 'failure'; reason: string; preparedTransactionId?: string };

export const executedSwap = (transactionId: string, blockNumber: number, timestamp: number): SwapSubmission =>
  ({ status: 'executed', transactionId, blockNumber, timestamp });

export const failedSwap = (reason: string, preparedTransactionId?: string): SwapSubmission =>
  ({ status: 'failure', reason, ...(preparedTransactionId ? { preparedTransactionId } : {}) });

export interface SwapVenue {
  /**
   * Settle the calling side of the swap. Synchronous contract: resolves only
   * once both legs have crossed (AMM venues execute in a single transaction;
   * bilateral venues submit this leg and wait for the counterparty's mirror),
   * or fails when intent.deadline passes.
   *
   * Implementations MUST be resumable and race-safe:
   * - if this side's leg is already recorded on-chain for the operationId
   *   (e.g. a retry after a crash), resume waiting instead of resubmitting;
   * - if the submission loses a race against the counterparty's simultaneous
   *   call, recover by mirroring or waiting — both parties calling swap()
   *   concurrently with mirrored intents is the normal single-operator flow.
   */
  swap(wallet: TokenWallet, intent: SwapIntent, logger: Logger): Promise<SwapSubmission>;
}
