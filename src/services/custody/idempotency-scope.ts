import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the adapter's idempotency key across the token-standard call into
 * the custody signer, which has no parameter path for it (standards invoke
 * plain ethers signers). Providers use it as their request-level idempotency
 * reference (Taurus: externalRequestId), so a retried operation resolves to
 * the original custody request instead of creating a second live one.
 */
const scope = new AsyncLocalStorage<{ key: string; requests: number }>();

export function runWithIdempotencyKey<T>(idempotencyKey: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ key: idempotencyKey, requests: 0 }, fn);
}

export function currentIdempotencyKey(): string | undefined {
  return scope.getStore()?.key;
}

/**
 * The position of this custody request among those the current operation has
 * raised, from 0. An operation run again raises its requests in the same order,
 * so the same request gets the same ordinal, while two identical requests of
 * one operation are told apart.
 */
export function nextRequestOrdinal(): number | undefined {
  const store = scope.getStore();
  return store ? store.requests++ : undefined;
}
