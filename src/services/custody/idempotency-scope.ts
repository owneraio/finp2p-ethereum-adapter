import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the adapter's idempotency key across the token-standard call into
 * the custody signer, which has no parameter path for it (standards invoke
 * plain ethers signers). Providers use it as their request-level idempotency
 * reference (Taurus: externalRequestId), so a retried operation resolves to
 * the original custody request instead of creating a second live one.
 */
const scope = new AsyncLocalStorage<string>();

export function runWithIdempotencyKey<T>(idempotencyKey: string, fn: () => Promise<T>): Promise<T> {
  return scope.run(idempotencyKey, fn);
}

export function currentIdempotencyKey(): string | undefined {
  return scope.getStore();
}
