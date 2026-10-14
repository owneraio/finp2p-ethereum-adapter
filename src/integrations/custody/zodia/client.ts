import { createSign, randomUUID, sign as ecdsaSign, constants as cryptoConstants } from 'crypto';

/**
 * Zodia Custody, API v3 (https://zodia-custody.com/zodia-custody-api-doc.html).
 *
 * Two keys, two roles. Every request is signed with the company's RSA key
 * (SHA256withRSA over `company:request-id:timestamp:url:payload`) and names
 * the API user submitting it. Anything that changes state goes through the
 * Digital Asset Service Desk as a service request: created, submitted,
 * confirmed by its maker — who signs the HSM instruction with their own
 * P-256 key — and then approved by a different user, the authoriser. This
 * adapter is the maker. It never approves as the authoriser: that is the
 * second pair of eyes the platform exists to provide, and there is nothing
 * here that could read what an approval commits to well enough to give it.
 */
export interface ZodiaClientConfig {
  /** `https://gateway-preprod.uat.api-zodia.io` for UAT, `https://api.custody.api-zodia.io` for production. */
  baseUrl: string;
  /** The `company-identifier` Zodia assigned at onboarding; uppercase, no spaces. */
  companyId: string;
  /** The API maker's email, sent as `submitter-id`; by convention `api-…@`. */
  submitterId: string;
  /** The company's RSA private key (PKCS#8 PEM, 2048 bits or more); signs every request. */
  companyPrivateKey: string;
  /** The maker's P-256 private key (PKCS#8 PEM); signs the instructions the maker confirms. */
  makerPrivateKey: string;
}

export interface ZodiaWallet {
  id: string;
  name?: string;
  status: 'ACTIVE' | 'DEACTIVATED' | string;
  currency: string;
  currencyId: string;
  balances?: { currency: string; availableBalance?: { amount: string; amountUnit?: string }; ledgerBalance?: { amount: string; amountUnit?: string } }[];
}

export interface ZodiaAddress {
  address: string;
  ledger?: string;
  currencyId?: string;
  walletId: string;
}

export interface ZodiaCurrency {
  currency: string;
  name?: string;
  /** Divisibility factor, `10^decimals` as a decimal string. */
  ratio: string;
  currencyId: string;
}

export interface ZodiaTransfer {
  id: string;
  status: string;
  type?: 'INCOMING' | 'OUTGOING' | string;
  currency: string;
  currencyId: string;
  amountLedger?: string;
  /** The chain transaction hash, present once the transfer is posted on chain. */
  ledgerRef?: string;
  createdAt?: string;
}

export interface ZodiaBeneficiaryAddress {
  cryptoAddressId: string;
  beneficiaryId?: string;
  address: string;
  blockchain: string;
  blockchainId: string;
  status: string;
  addressPurpose?: string[];
}

export interface ZodiaServiceRequest {
  requestId: string;
  serviceId: string;
  endToEndId?: string;
  status: string;
  entityId?: string;
  createdAt?: string;
}

export interface ZodiaServiceDeskResponse {
  requestId: string;
  pluginDetail?: { entityId?: string; details?: unknown[] };
}

/** What `servicedesk/pending` hands the maker: the HSM instruction and a placeholder for their signature. */
export interface ZodiaInstruction {
  request: Record<string, unknown>;
  signature: string;
}

export type ZodiaParty = { type: 'WALLETID'; value: string } | { type: 'BENEFICIARYADDRESSID'; value: string };

/** Service ids of the Digital Asset Service Desk products this adapter uses. */
export const ZODIA_SERVICE = {
  createWallet: '0x0013-001',
  transfer: '0x0014-007',
} as const;

const paged = <T>(reply: { items?: T[] } | T[] | undefined): T[] => (Array.isArray(reply) ? reply : reply?.items ?? []);

export class ZodiaClient {
  constructor(private readonly config: ZodiaClientConfig) {}

  /**
   * The five headers every request carries. The signed string is exactly
   * `company:request-id:timestamp:url:payload`, the url decoded and absolute,
   * and the payload the very bytes sent — a GET ends with the colon.
   */
  requestHeaders(url: string, body: string): Record<string, string> {
    const requestId = randomUUID();
    const timestamp = Date.now().toString();
    const toSign = [this.config.companyId, requestId, timestamp, url, body].join(':');
    const signer = createSign('RSA-SHA256');
    signer.update(toSign, 'utf-8');
    const signature = signer.sign({ key: this.config.companyPrivateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, 'base64');
    return {
      'company-identifier': this.config.companyId,
      'submitter-id': this.config.submitterId,
      'request-identifier': requestId,
      'request-timestamp': timestamp,
      signature,
      'Content-Type': 'application/json',
    };
  }

  /**
   * The maker's signature over an instruction: ECDSA P-256 with SHA-256 over
   * the stable stringification of `request`, keys sorted and nothing empty,
   * DER encoded and base64. The same stringified object is what gets sent.
   */
  signAsMaker(request: Record<string, unknown>): { request: Record<string, unknown>; signature: string } {
    const canonical = stableStringify(request);
    const signature = ecdsaSign('sha256', Buffer.from(canonical, 'utf-8'), { key: this.config.makerPrivateKey, dsaEncoding: 'der' }).toString('base64');
    return { request: JSON.parse(canonical) as Record<string, unknown>, signature };
  }

  // ------------------------------------------------------------- custody reads

  async wallets(filter: { ids?: string[]; names?: string[]; currenciesIds?: string[]; statuses?: string[]; paginationLimit?: number } = {}): Promise<ZodiaWallet[]> {
    return paged(await this.post<{ items?: ZodiaWallet[] }>('/v3/api/custody/wallets', { paginationLimit: 100, ...filter }));
  }

  /** Per-address balances of a wallet, as fixed-point strings. */
  async walletBalances(walletId: string): Promise<{ address: string; balance: string; currency?: string }[]> {
    return paged(await this.post<{ address: string; balance: string; currency?: string }[]>('/v3/api/custody/wallets/balance', { walletId, hideZeroBalance: false }));
  }

  async addresses(filter: { walletIds?: string[]; addresses?: string[]; currenciesIds?: string[]; paginationLimit?: number } = {}): Promise<ZodiaAddress[]> {
    return paged(await this.post<{ items?: ZodiaAddress[] }>('/v3/api/custody/wallets/addresses', { paginationLimit: 100, ...filter }));
  }

  async generateAddress(walletId: string, currencyId?: string): Promise<ZodiaAddress> {
    return this.post<ZodiaAddress>('/v3/api/custody/wallets/addresses/generate', currencyId ? { walletId, currencyId } : { walletId });
  }

  async currencies(): Promise<ZodiaCurrency[]> {
    return paged(await this.post<{ items?: ZodiaCurrency[] }>('/v3/api/custody/currencies', {}));
  }

  async transactions(filter: { walletIds?: string[]; statuses?: string[]; currenciesIds?: string[]; fromDate?: string; paginationLimit?: number } = {}): Promise<ZodiaTransfer[]> {
    return paged(await this.post<{ items?: ZodiaTransfer[] }>('/v3/api/custody/transactions', { paginationLimit: 100, ...filter }));
  }

  async beneficiaryAddresses(filter: { addresses?: string[]; blockchainIds?: string[]; statuses?: string[]; paginationLimit?: number } = {}): Promise<ZodiaBeneficiaryAddress[]> {
    return paged(await this.post<{ items?: ZodiaBeneficiaryAddress[] } | ZodiaBeneficiaryAddress[]>('/v3/api/netwmgmt/addresses', { paginationLimit: 100, ...filter }));
  }

  // ------------------------------------------------------------ service desk

  /** `serviceIds` is required by Zodia, and so are the product ids, which are the service ids' prefix. */
  async serviceRequests(filter: { serviceIds: string[]; requestIds?: string[]; endToEndIds?: string[]; entityIds?: string[]; statuses?: string[]; paginationLimit?: number }): Promise<ZodiaServiceRequest[]> {
    const productIds = [...new Set(filter.serviceIds.map(id => id.split('-')[0]!))];
    return paged(await this.post<{ items?: ZodiaServiceRequest[] }>('/v3/api/servicedesk/requests', { paginationLimit: 100, productIds, ...filter }));
  }

  /** Step 1 of every state change: a service request in DRAFT. `endToEndId` is the caller's own reference, a UUID, and what a retry is found by. */
  async createServiceRequest(serviceId: string, payload: Record<string, unknown>, endToEndId?: string): Promise<ZodiaServiceDeskResponse> {
    return this.post<ZodiaServiceDeskResponse>('/v3/api/servicedesk/create', endToEndId ? { serviceId, endToEndId, payload } : { serviceId, payload });
  }

  /** Step 2: submit. From here the maker has 120 seconds to confirm. */
  async submitServiceRequest(requestId: string): Promise<void> {
    await this.post<unknown>('/v3/api/servicedesk/submit', { requestId });
  }

  /** Step 3: the instruction awaiting this user's signature, or nothing yet. */
  async pendingInstruction(requestId: string): Promise<ZodiaInstruction | ZodiaInstruction[] | undefined> {
    const reply = await this.post<ZodiaInstruction | ZodiaInstruction[] | ''>('/v3/api/servicedesk/pending', { requestId });
    return reply === '' || reply === undefined || reply === null ? undefined : reply;
  }

  /** Step 4: the maker confirms what step 3 returned, signed with the maker's key. */
  async confirmAsMaker(requestId: string, instruction: ZodiaInstruction): Promise<void> {
    const signed = this.signAsMaker(instruction.request);
    await this.post<unknown>('/v3/api/servicedesk/approve', { requestId, request: signed.request, signature: signed.signature });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const payload = JSON.stringify(body);
    const res = await fetch(url, { method: 'POST', headers: this.requestHeaders(url, payload), body: payload });
    const text = await res.text();
    if (!res.ok) throw new ZodiaApiError(res.status, path, text);
    return (text ? JSON.parse(text) : '') as T;
  }
}

/** A Zodia refusal, with the `ER-…` codes that Zodia asks to be quoted back to them. */
export class ZodiaApiError extends Error {
  readonly codes: string[];

  constructor(readonly status: number, readonly path: string, body: string) {
    const parsed = tryParse(body) as { title?: string; details?: { code?: string; message?: string }[]; message?: string; code?: string } | undefined;
    const details = parsed?.details ?? (parsed?.code ? [{ code: parsed.code, message: parsed.message }] : []);
    const codes = details.map(d => d.code).filter((c): c is string => !!c);
    const messages = details.map(d => d.message).filter(Boolean);
    super(`Zodia ${path} answered ${status}${parsed?.title ? ` ${parsed.title}` : ''}${codes.length ? ` [${codes.join(', ')}]` : ''}: ${messages.join('; ') || body.slice(0, 300)}`);
    this.name = 'ZodiaApiError';
    this.codes = codes;
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * json-stable-stringify as Zodia specifies for signed instructions: keys
 * sorted, no whitespace, and nothing optional-and-empty. Arrays keep their
 * order, since order is meaning there.
 */
export function stableStringify(value: unknown): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        const inner = strip((v as Record<string, unknown>)[key]);
        if (inner === undefined || inner === null || inner === '') continue;
        if (Array.isArray(inner) && inner.length === 0) continue;
        if (inner && typeof inner === 'object' && !Array.isArray(inner) && Object.keys(inner).length === 0) continue;
        out[key] = inner;
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(value));
}
