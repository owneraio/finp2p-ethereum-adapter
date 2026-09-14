import { createHash, createHmac, createPrivateKey, randomUUID, sign as ecdsaSign } from 'crypto';
import { TaurusAppConfig } from './config';

/**
 * Minimal Taurus-PROTECT REST client — hand-rolled HMAC auth (the official
 * TypeScript SDK is not on public npm) plus the request-lifecycle calls the
 * custody provider needs. Live-verified against the UAT tg-validatord: TPV1
 * signing, {result: [...]} envelopes, /whitelists/{addresses,contracts}
 * paths with metadata.payloadAsString envelopes, and the full request
 * pipeline (CREATED -> APPROVED -> BROADCASTING -> CONFIRMED) with the
 * on-chain hash reported in signedRequests[].hash.
 */

export interface TaurusAddress {
  id: string;
  walletId: string;
  address: string;
  label?: string;
}

export interface TaurusCurrency {
  id: string;
  symbol: string;
  contractAddress?: string;
  decimals?: string;
}

export interface TaurusRequest {
  id: string;
  status: string;
  metadata?: { hash?: string };
  /** blockchain hashes are reported per signed transaction, not top-level */
  signedRequests?: { hash?: string; status?: string }[];
}

/** first on-chain hash reported by the request's signed transactions */
export function transactionHashOf(request: TaurusRequest): string | undefined {
  return request.signedRequests?.find(s => s.hash)?.hash;
}

export interface ContractArgValue {
  primitive?: string;
  composite?: ContractArgValue[];
}

export interface ContractArg {
  name?: string;
  type: string;
  value: ContractArgValue;
}

export interface ContractCall {
  functionSignature: string;
  args: ContractArg[];
}

const PAGE_LIMIT = 100;

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

  async listAddresses(): Promise<TaurusAddress[]> {
    const all: TaurusAddress[] = [];
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const reply = await this.call<{ result?: TaurusAddress[]; addresses?: TaurusAddress[] }>(
        'GET', '/api/rest/v1/addresses', { query: `limit=${PAGE_LIMIT}&offset=${offset}` });
      const page = reply.result ?? reply.addresses ?? [];
      all.push(...page);
      if (page.length < PAGE_LIMIT) return all;
    }
  }

  async getAddress(addressId: string): Promise<TaurusAddress> {
    const reply = await this.call<{ result?: TaurusAddress } | TaurusAddress>('GET', `/api/rest/v1/addresses/${addressId}`);
    return (reply as { result?: TaurusAddress }).result ?? (reply as TaurusAddress);
  }

  /** Whitelist entries are signed envelopes; the authoritative content is
   *  metadata.payloadAsString (the string the approval hash covers) — parse
   *  the chain address from it rather than trusting mutable display fields. */
  private async findWhitelistId(
    path: string, address: string, payloadAddressField: string,
  ): Promise<string | undefined> {
    type Entry = { id: string; address?: string; metadata?: { payloadAsString?: string; payload?: Record<string, unknown> } };
    const wanted = address.toLowerCase();
    const addressOf = (w: Entry): string | undefined => {
      const raw = w.metadata?.payloadAsString;
      if (raw) {
        try {
          const payload = JSON.parse(raw) as Record<string, unknown>;
          const a = payload[payloadAddressField];
          if (typeof a === 'string') return a;
        } catch { /* fall through to the parsed payload / top-level field */ }
      }
      const parsed = w.metadata?.payload?.[payloadAddressField];
      if (typeof parsed === 'string') return parsed;
      return w.address;
    };
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const reply = await this.call<{ result?: Entry[] }>('GET', path, { query: `limit=${PAGE_LIMIT}&offset=${offset}` });
      const page = reply.result ?? [];
      const hit = page.find(w => addressOf(w)?.toLowerCase() === wanted);
      if (hit) return hit.id;
      if (page.length < PAGE_LIMIT) return undefined;
    }
  }

  /** Whitelisted external (payout) addresses. */
  async findWhitelistedAddressId(address: string): Promise<string | undefined> {
    return this.findWhitelistId('/api/rest/v1/whitelists/addresses', address, 'address');
  }

  /** Whitelisted contracts live under a separate endpoint with their own
   *  payload shape ({blockchain, contractAddress, symbol, ...}). */
  async findWhitelistedContractId(contractAddress: string): Promise<string | undefined> {
    return this.findWhitelistId('/api/rest/v1/whitelists/contracts', contractAddress, 'contractAddress');
  }

  /** A whitelisted+approved contract becomes a PROTECT currency; token
   *  transfers reference it by symbol. Cached, with one refetch on a miss so
   *  freshly approved tokens are picked up. */
  private currencies?: TaurusCurrency[];

  async findCurrencyByContract(contractAddress: string): Promise<TaurusCurrency | undefined> {
    const wanted = contractAddress.toLowerCase();
    const match = () => this.currencies?.find(c => c.contractAddress?.toLowerCase() === wanted);
    if (this.currencies && match()) return match();
    const reply = await this.call<{ result?: TaurusCurrency[] }>('GET', '/api/rest/v1/currencies');
    this.currencies = reply.result ?? [];
    return match();
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

  /** Address-to-address transfer of a registered currency (live-verified:
   *  this is how PROTECT moves ERC20s — it builds and signs the token call
   *  itself). fromAddress/toAddress are chain (0x…) addresses; amount is in
   *  the smallest currency unit. PROTECT matches addresses case-sensitively
   *  against its lowercase storage (live-verified: a checksummed form of a
   *  known internal address is rejected as not found), so both are lowercased. */
  async createAddressToAddressTransfer(params: {
    fromAddress: string;
    toAddress: string;
    amount: string;
    currency: string;
    comment?: string;
  }): Promise<TaurusRequest> {
    const body = { ...params, fromAddress: params.fromAddress.toLowerCase(), toAddress: params.toAddress.toLowerCase() };
    const reply = await this.call<{ result?: TaurusRequest } | TaurusRequest>('POST', '/api/rest/v1/requests/outgoing/transfers/address_to_address', { body });
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
