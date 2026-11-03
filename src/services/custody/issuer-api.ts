import winston from 'winston';
import { AssetRecord, OperationContext } from '@owneraio/finp2p-ethereum-adapter-contract';

export type IssuerApiResult =
  | { status: 'success'; transactionId: string; timestamp: number }
  | { status: 'failure'; reason: string; submitted?: boolean };

export interface IssuerApiIssuance {
  issueByApi(asset: AssetRecord, to: string, amount: bigint, operationId: string, logger: winston.Logger, opCtx?: OperationContext): Promise<IssuerApiResult>;
  redeemByApi?(asset: AssetRecord, from: string, amount: bigint, operationId: string, logger: winston.Logger, opCtx?: OperationContext): Promise<IssuerApiResult>;
}

export const issuesByApi = (standard: unknown): standard is IssuerApiIssuance =>
  typeof (standard as Partial<IssuerApiIssuance> | undefined)?.issueByApi === 'function';

export type IssuerApiBackoff = { firstMs: number; maxMs: number };

export const DEFAULT_ISSUER_API_BACKOFF: IssuerApiBackoff = { firstMs: 60_000, maxMs: 15 * 60_000 };

export async function untilIssuerApiSettles(
  ask: () => Promise<IssuerApiResult>, logger: winston.Logger, tag: string,
  backoff: IssuerApiBackoff = DEFAULT_ISSUER_API_BACKOFF,
): Promise<IssuerApiResult> {
  let delay = backoff.firstMs;
  for (;;) {
    const result = await ask();
    if (result.status === 'success' || !result.submitted) return result;
    logger.info(`${tag}: ${result.reason}; asking again in ${Math.round(delay / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, backoff.maxMs);
  }
}
