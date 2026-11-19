import { Wallet } from 'ethers';
import { FireblocksSDK } from 'fireblocks-sdk';
import { DfnsApiClient } from '@dfns/sdk';
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner';
import { TaurusClient } from '../../integrations/custody/taurus/client';
import { ConfigValues } from './schema';

export interface ValidationResult {
  status: 'valid' | 'invalid';
  message: string;
  details?: { label: string; value: string }[];
}

/** Read-only check behind a validation ref; receives every current value, sealed ones opened. */
export type Validator = (values: ConfigValues) => Promise<ValidationResult>;

const valid = (message: string, details?: ValidationResult['details']): ValidationResult => ({ status: 'valid', message, details });
const invalid = (message: string, details?: ValidationResult['details']): ValidationResult => ({ status: 'invalid', message, details });
const reason = (e: unknown): string => {
  const cause: any = (e as any)?.cause;
  const detail = cause ? ` (${cause.code ?? cause.message ?? cause})` : '';
  return `${e instanceof Error ? e.message : String(e)}${detail}`.slice(0, 240);
};
const httpStatus = (e: any): number | undefined => e?.response?.status ?? e?.status ?? e?.httpStatus;

const RPC_TIMEOUT_MS = 10_000;

async function rpc(url: string, auth: string | undefined, method: string, params: unknown[]): Promise<any> {
  const target = new URL(url);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const credentials = auth || (target.username ? `${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}` : undefined);
  if (credentials) headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  target.username = '';
  target.password = '';
  const res = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

async function chainId(values: ConfigValues): Promise<bigint> {
  return BigInt(await rpc(values['network.rpcUrl']!, values['network.auth'], 'eth_chainId', []));
}

export const ethereumAdapterValidators: Record<string, Validator> = {
  'network.rpcUrl': async (v) => {
    try {
      const id = await chainId(v);
      return valid(`The RPC answered on chain ${id}.`, [{ label: 'Chain ID', value: id.toString() }]);
    } catch (e) {
      return invalid(`The RPC did not answer eth_chainId: ${reason(e)}`);
    }
  },

  contract: async (v) => {
    let id: bigint;
    try {
      id = await chainId(v);
    } catch (e) {
      return invalid(`The RPC did not answer, so the contract could not be checked: ${reason(e)}`);
    }
    const address = v['contract.address']!;
    const code: string = await rpc(v['network.rpcUrl']!, v['network.auth'], 'eth_getCode', [address, 'latest']);
    if (!code || code === '0x') return invalid(`No contract is deployed at ${address} on chain ${id}.`, [{ label: 'Chain ID', value: id.toString() }]);
    const key = v['contract.operatorKey']!;
    const operator = new Wallet(key.startsWith('0x') ? key : `0x${key}`).address;
    const balance = BigInt(await rpc(v['network.rpcUrl']!, v['network.auth'], 'eth_getBalance', [operator, 'latest']));
    return valid(`Contract found on chain ${id}; the key belongs to operator ${operator}.`, [
      { label: 'Chain ID', value: id.toString() },
      { label: 'Contract code', value: `${(code.length - 2) / 2} bytes` },
      { label: 'Operator', value: operator },
      { label: 'Operator balance (wei)', value: balance.toString() },
    ]);
  },

  fireblocks: async (v) => {
    const baseUrl = (v['fireblocks.apiBaseUrl'] || 'https://api.fireblocks.io').replace(/\/v1\/?$/, '');
    try {
      const sdk = new FireblocksSDK(v['fireblocks.privateKey']!, v['fireblocks.apiKey']!, baseUrl);
      const page = await sdk.getVaultAccountsWithPageInfo({ limit: 1 });
      const first = page.accounts?.[0];
      return valid('Fireblocks accepted the API key and its private key.', [
        { label: 'Workspace', value: new URL(baseUrl).host },
        { label: 'First vault account', value: first ? `${first.id} · ${first.name}` : 'none yet' },
      ]);
    } catch (e) {
      const status = httpStatus(e);
      if (status === 401 || status === 403) return invalid(`Fireblocks rejected the request (${status}): the private key does not belong to this API key, or the key is not enabled.`);
      return invalid(`Fireblocks could not be reached: ${reason(e)}`);
    }
  },

  dfns: async (v) => {
    try {
      const signer = new AsymmetricKeySigner({ credId: v['dfns.credId']!, privateKey: v['dfns.privateKey']! });
      const client = new DfnsApiClient({ baseUrl: v['dfns.baseUrl'] || 'https://api.dfns.io', orgId: v['dfns.orgId']!, authToken: v['dfns.authToken']!, signer });
      const page = await client.wallets.listWallets({ query: { limit: 1 } });
      const first = page.items?.[0];
      return valid('DFNS accepted the service account token. The credential key is checked for format; its first signed request confirms it.', [
        { label: 'Organization', value: v['dfns.orgId']! },
        { label: 'First wallet', value: first ? `${first.id} · ${first.network}` : 'none yet' },
      ]);
    } catch (e) {
      const status = httpStatus(e);
      if (status === 401 || status === 403) return invalid(`DFNS rejected the service account token (${status}) for organization ${v['dfns.orgId']}.`);
      return invalid(`DFNS could not be reached: ${reason(e)}`);
    }
  },

  taurus: async (v) => {
    const client = new TaurusClient({
      host: v['taurus.host']!.replace(/\/+$/, ''),
      apiKey: v['taurus.apiKey']!,
      apiSecret: v['taurus.apiSecret']!,
      authScheme: (v['taurus.authScheme'] || 'TPV1') as 'TPV1' | 'TDXV1',
      operationMode: 'transfer-only',
      blockchain: v['taurus.blockchain'] || 'ETH',
      network: v['taurus.network'] || 'mainnet',
      requestPollIntervalMs: 3000,
      requestTimeoutMs: 300000,
    });
    let id: bigint;
    try {
      id = await client.getChainId();
    } catch (e) {
      const status = httpStatus(e);
      if (status === 401 || status === 403) return invalid(`PROTECT rejected the request signature (${status}): check the API key and secret.`);
      return invalid(`PROTECT could not be reached: ${reason(e)}`);
    }
    const details = [{ label: 'Chain ID', value: id.toString() }, { label: 'Chain reads', value: v['network.rpcUrl'] ? 'From the configured RPC' : 'From PROTECT' }];
    if (v['network.rpcUrl']) {
      const rpcChain = await chainId(v).catch(() => undefined);
      if (rpcChain !== undefined && rpcChain !== id) return invalid(`PROTECT is on chain ${id}, but the configured RPC is on chain ${rpcChain}.`, details);
    }
    return valid(`PROTECT accepted the request; ${v['taurus.blockchain'] || 'ETH'} ${v['taurus.network'] || 'mainnet'} is chain ${id}.`, details);
  },
};
