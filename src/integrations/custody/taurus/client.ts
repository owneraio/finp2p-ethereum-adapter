import { createHash, createHmac, createSign, randomUUID } from 'crypto';
import { TaurusAppConfig } from './config';

/**
 * Minimal Taurus-PROTECT/TDX REST client — hand-rolled HMAC auth (the official
 * TypeScript SDK is not on public npm) plus the request-lifecycle calls the
 * custody provider needs. Endpoint shapes follow docs.taurushq.com; the ones
 * marked PoC-unverified still need a live round-trip against the UAT instance.
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

  /** PoC-unverified path: the whitelisted-addresses listing, needed to resolve
   *  toWhitelistedAddressId for transfers and contract calls. */
  async findWhitelistedAddressId(address: string): Promise<string | undefined> {
    const reply = await this.call<{ result?: Array<{ id: string; address: string }> }>('GET', '/api/rest/v1/whitelisted-addresses', { query: `limit=500` });
    const hit = (reply.result ?? []).find(w => w.address?.toLowerCase() === address.toLowerCase());
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

  /** Self-approval with the service account's operator key: ECDSA-SHA256 over
   *  the sorted metadata.hash list, base64-encoded. */
  async approveRequests(requests: TaurusRequest[], comment = 'auto-approved by finp2p adapter'): Promise<void> {
    const operatorKey = this.config.operatorPrivateKey;
    if (!operatorKey) {
      throw new Error('TAURUS_OPERATOR_PRIVATE_KEY is not configured — requests need manual approval in the console');
    }
    const ids = requests.map(r => r.id).sort();
    const hashes = requests
      .map(r => r.metadata?.hash)
      .filter((h): h is string => !!h)
      .sort();
    const signer = createSign('SHA256');
    signer.update(hashes.join(''));
    const signature = signer.sign(operatorKey).toString('base64');
    await this.call('POST', '/api/rest/v1/requests/approve', { body: { comment, ids, signature } });
  }
}
