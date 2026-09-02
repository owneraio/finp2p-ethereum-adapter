export interface TaurusAppConfig {
  host: string;
  apiKey: string;
  apiSecret: string;
  /** TDXV1 (t-dx.com instances) or TPV1 (vanilla PROTECT) */
  authScheme: 'TDXV1' | 'TPV1';
  rpcUrl: string;
  /** unencrypted ECDSA operator key of a RequestApprover service account —
   *  enables end-to-end self-approval; without it requests wait for a human */
  operatorPrivateKey?: string;
  /** poll cadence for the request approval/broadcast pipeline */
  requestPollIntervalMs: number;
  requestTimeoutMs: number;
}

export function createTaurusAppConfig(rpcUrl: string): TaurusAppConfig {
  const host = process.env.TAURUS_HOST;
  const apiKey = process.env.TAURUS_API_KEY;
  const apiSecret = process.env.TAURUS_API_SECRET;
  const authScheme = (process.env.TAURUS_AUTH_SCHEME ?? 'TDXV1') as TaurusAppConfig['authScheme'];
  const operatorPrivateKey = process.env.TAURUS_OPERATOR_PRIVATE_KEY;
  const requestPollIntervalMs = Number(process.env.TAURUS_REQUEST_POLL_INTERVAL_MS ?? 3000);
  const requestTimeoutMs = Number(process.env.TAURUS_REQUEST_TIMEOUT_MS ?? 300000);

  if (!host) throw new Error('TAURUS_HOST is required for PROVIDER_TYPE=taurus');
  if (!apiKey || !apiSecret) throw new Error('TAURUS_API_KEY and TAURUS_API_SECRET are required for PROVIDER_TYPE=taurus');
  if (authScheme !== 'TDXV1' && authScheme !== 'TPV1') throw new Error(`TAURUS_AUTH_SCHEME must be TDXV1 or TPV1, got '${authScheme}'`);

  return { host, apiKey, apiSecret, authScheme, rpcUrl, operatorPrivateKey, requestPollIntervalMs, requestTimeoutMs };
}
