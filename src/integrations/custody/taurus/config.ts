/** How token operations reach PROTECT:
 *  - 'contract-call': every token operation is submitted as the structured
 *    form of the token standard's contract call (the same operation the other
 *    custody providers sign) — token standards are supported; requires the
 *    token contracts whitelisted as ADDRESSES plus contract-interaction
 *    governance rules.
 *  - 'transfer-only': plain ERC20 transfers only, as PROTECT-native currency
 *    transfers (the live-verified path); every other token operation (mint,
 *    burn, approve, ...) is refused — token standards are NOT supported. */
export type TaurusOperationMode = 'contract-call' | 'transfer-only';

export interface TaurusAppConfig {
  host: string;
  apiKey: string;
  apiSecret: string;
  /** TPV1 (PROTECT validatord — live-verified on the UAT instance) or TDXV1 */
  authScheme: 'TPV1' | 'TDXV1';
  operationMode: TaurusOperationMode;
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
  const authScheme = (process.env.TAURUS_AUTH_SCHEME ?? 'TPV1') as TaurusAppConfig['authScheme'];
  const operationMode = (process.env.TAURUS_OPERATION_MODE ?? 'transfer-only') as TaurusOperationMode;
  const operatorPrivateKey = process.env.TAURUS_OPERATOR_PRIVATE_KEY;
  const requestPollIntervalMs = Number(process.env.TAURUS_REQUEST_POLL_INTERVAL_MS ?? 3000);
  const requestTimeoutMs = Number(process.env.TAURUS_REQUEST_TIMEOUT_MS ?? 300000);

  if (!host) throw new Error('TAURUS_HOST is required for PROVIDER_TYPE=taurus');
  if (!apiKey || !apiSecret) throw new Error('TAURUS_API_KEY and TAURUS_API_SECRET are required for PROVIDER_TYPE=taurus');
  if (authScheme !== 'TPV1' && authScheme !== 'TDXV1') throw new Error(`TAURUS_AUTH_SCHEME must be TDXV1 or TPV1, got '${authScheme}'`);
  if (operationMode !== 'contract-call' && operationMode !== 'transfer-only') {
    throw new Error(`TAURUS_OPERATION_MODE must be contract-call or transfer-only, got '${operationMode}'`);
  }

  return { host, apiKey, apiSecret, authScheme, operationMode, rpcUrl, operatorPrivateKey, requestPollIntervalMs, requestTimeoutMs };
}
