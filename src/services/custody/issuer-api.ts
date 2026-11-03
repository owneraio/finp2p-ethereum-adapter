import winston from 'winston';
import { failedTokenOp, TokenOperationResult } from '@owneraio/finp2p-ethereum-adapter-contract';

export type IssuerApiBackoff = { firstMs: number; maxMs: number; deadlineMs: number };

export const DEFAULT_ISSUER_API_BACKOFF: IssuerApiBackoff = {
  firstMs: 60_000,
  maxMs: 15 * 60_000,
  deadlineMs: 96 * 60 * 60_000,
};

export async function untilIssuerApiSettles(
  ask: () => Promise<TokenOperationResult>, logger: winston.Logger, tag: string,
  backoff: IssuerApiBackoff = DEFAULT_ISSUER_API_BACKOFF,
): Promise<TokenOperationResult> {
  const giveUpAt = Date.now() + backoff.deadlineMs;
  let delay = backoff.firstMs;
  for (;;) {
    const result = await ask();
    if (result.status === 'success' || !result.submitted) return result;
    const left = giveUpAt - Date.now();
    if (left <= 0) {
      logger.error(`${tag}: no final answer from the issuer in ${Math.round(backoff.deadlineMs / 60_000)} min; leaving the order for manual handling`);
      return failedTokenOp(`${result.reason}; no final answer within ${Math.round(backoff.deadlineMs / 60_000)} min, so the order is left for manual handling and may still settle`, false);
    }
    const wait = Math.min(delay, left);
    logger.info(`${tag}: ${result.reason}; asking again in ${Math.round(wait / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    delay = Math.min(delay * 2, backoff.maxMs);
  }
}
