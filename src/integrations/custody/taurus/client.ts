import { createHash, createHmac, createPrivateKey, randomUUID, sign as ecdsaSign } from 'crypto';
import { TaurusAppConfig } from './config';

/**
 * Minimal Taurus-PROTECT REST client — hand-rolled HMAC auth (the official
 * TypeScript SDK is not on public npm) plus the request-lifecycle calls the
 * custody provider needs. Live-verified against the UAT tg-validatord: TPV1
 * signing, {result: [...]} envelopes, /whitelists/{addresses,contracts}
 * paths; the request create/approve round-trip still needs a live run with
 * an operator key.
 */

export interface TaurusAddress {
  id: string;
  walletId: string;
  address: string;
  label?: string;
}

export interface TaurusRequest {
  id: string;
  status: string;
  metadata?: { hash?: string };
  transactionHash?: string;
}

export interface ContractCall {
  functionSignature: string;
  args: unknown[];
}

export class TaurusClient {

  constructor(private readonly config: TaurusAppConfig) {}

  /** string_to_hash = "<SCHEME> <apiKey> <nonce> <ts> <METHOD> <host> <path> <query> <content-type> <body>",
   *  space-joined with empty parts omitted; TDXV1 hashes it (base64(sha256))
   *  before the HMAC, TPV1 HMACs the string directly; secret is hex. */
  authorizationHeader(method: string, path: string, query = '', contentType = '', body = ''): string {
    const { apiKey, apiSecret, authScheme, host } = this.config;
    const nonce = randomUUID();
    const timestamp = Date.now().toString();
    const stringToHash = [authScheme, apiKey, nonce, timestamp, method.toUpperCase(), new URL(host).host, path, query, contentType, body]
      .filter(p => p !== '' && p !== undefined && p !== null)
      .join(' ');
    const payload = authScheme === 'TDXV1'
      ? createHash('sha256').update(stringToHash).digest('base64')
      : stringToHash;
    const signature = createHmac('sha256', Buffer.from(apiSecret, 'hex')).update(payload).digest('base64');
    return `${authScheme}-HMAC-SHA256 ApiKey=${apiKey} Nonce=${nonce} Timestamp=${timestamp} Signature=${signature}`;
  }

  private async call<T>(method: string, path: string, opts: { query?: string; body?: unknown } = {}): Promise<T> {
    const query = opts.query ?? '';
    const body = opts.body === undefined ? '' : JSON.stringify(opts.body);
    const contentType = body ? 'application/json' : '';
    const headers: Record<string, string> = {
      Authorization: this.authorizationHeader(method, path, query, contentType, body),
    };
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(`${this.config.host}${path}${query ? `?${query}` : ''}`, {
      method, headers, body: body || undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Taurus ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) as T : (undefined as T);
  }

  async listAddresses(limit = 500): Promise<TaurusAddress[]> {
    const reply = await this.call<{ result?: TaurusAddress[]; addresses?: TaurusAddress[] }>('GET', '/api/rest/v1/addresses', { query: `limit=${limit}` });
    return reply.result ?? reply.addresses ?? [];
  }

  async getAddress(addressId: string): Promise<TaurusAddress> {
    const reply = await this.call<{ result?: TaurusAddress } | TaurusAddress>('GET', `/api/rest/v1/addresses/${addressId}`);
    return (reply as { result?: TaurusAddress }).result ?? (reply as TaurusAddress);
  }

  /** Whitelisted external addresses (live-verified path). Entries carry a
   *  signed envelope; the chain address may sit at the top level or inside
   *  signedAddress, so both are checked. */
  async findWhitelistedAddressId(address: string): Promise<string | undefined> {
    type Entry = { id: string; address?: string; signedAddress?: { address?: { address?: string } } };
    const reply = await this.call<{ result?: Entry[] }>('GET', '/api/rest/v1/whitelists/addresses', { query: 'limit=500' });
    const hit = (reply.result ?? []).find(w => {
      const a = w.address ?? w.signedAddress?.address?.address;
      return a?.toLowerCase() === address.toLowerCase();
    });
    return hit?.id;
  }

  async createContractCallRequest(params: {
    fromAddressId: string;
    toWhitelistedAddressId: string;
    method: ContractCall;
    amount?: string;
    gasLimit?: string;
    comment?: string;
  }): Promise<TaurusRequest> {
    const reply = await this.call<{ result?: TaurusRequest } | TaurusRequest>('POST', '/api/rest/v1/requests/outgoing/contracts/call', { body: params });
    return (reply as { result?: TaurusRequest }).result ?? (reply as TaurusRequest);
  }

  async createTransferRequest(params: {
    fromAddressId: string;
    toWhitelistedAddressId: string;
    amount: string;
    comment?: string;
  }): Promise<TaurusRequest> {
    const reply = await this.call<{ result?: TaurusRequest } | TaurusRequest>('POST', '/api/rest/v1/requests/outgoing', { body: params });
    return (reply as { result?: TaurusRequest }).result ?? (reply as TaurusRequest);
  }

  async getRequest(id: string): Promise<TaurusRequest> {
    const reply = await this.call<{ result?: TaurusRequest } | TaurusRequest>('GET', `/api/rest/v1/requests/${id}`);
    return (reply as { result?: TaurusRequest }).result ?? (reply as TaurusRequest);
  }

  /** Self-approval with the service account's operator key. Recipe per the
   *  official SDK: sort requests by numeric id, JSON-encode the array of
   *  metadata.hash values, ECDSA-P256/SHA-256 sign it in raw r||s form
   *  (Java's SHA256withPLAIN-ECDSA; node: dsaEncoding ieee-p1363), base64. */
  async approveRequests(requests: TaurusRequest[], comment = 'auto-approved by finp2p adapter'): Promise<void> {
    const operatorKey = this.config.operatorPrivateKey;
    if (!operatorKey) {
      throw new Error('TAURUS_OPERATOR_PRIVATE_KEY is not configured — requests need manual approval in the console');
    }
    for (const r of requests) {
      if (!r.metadata?.hash) throw new Error(`Taurus request ${r.id} carries no metadata.hash — cannot approve`);
    }
    const sorted = [...requests].sort((a, b) => Number(a.id) - Number(b.id));
    const hashesJson = JSON.stringify(sorted.map(r => r.metadata!.hash));
    const key = createPrivateKey(operatorKey);
    const details = key.asymmetricKeyDetails;
    if (details?.namedCurve && details.namedCurve !== 'prime256v1' && details.namedCurve !== 'P-256') {
      throw new Error(`Taurus approval keys must be ECDSA P-256, got ${details.namedCurve}`);
    }
    const signature = ecdsaSign('sha256', Buffer.from(hashesJson, 'utf-8'), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
    await this.call('POST', '/api/rest/v1/requests/approve', { body: { comment, ids: sorted.map(r => String(r.id)), signature } });
  }
}
