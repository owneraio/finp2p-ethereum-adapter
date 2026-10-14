import fs from 'fs';

/** How Zodia names something it moves: a currency code and the currency id that pins the network. */
export interface ZodiaCurrencyRef {
  currency: string;
  currencyId: string;
}

export interface ZodiaAppConfig {
  baseUrl: string;
  companyId: string;
  submitterId: string;
  companyPrivateKey: string;
  makerPrivateKey: string;
  /** the chain's own coin; resolved from the company's wallets when not configured */
  native?: ZodiaCurrencyRef;
  /** ERC-20 contracts Zodia lists as currencies, keyed by lowercase contract address */
  tokens: Map<string, ZodiaCurrencyRef>;
  /**
   * How often to ask Zodia about a transfer in flight: first after this long,
   * then twice as long each time, up to the maximum. Zodia's default limit is
   * 1 request/s and 128/day per endpoint, and an authoriser may take hours.
   */
  pollIntervalMs: number;
  maxPollIntervalMs: number;
  /** the maker has 120 s from submit to confirm */
  makerPollIntervalMs: number;
}

export const ZODIA_UAT_URL = 'https://gateway-preprod.uat.api-zodia.io';

/** Zodia lists Sepolia's coin under the lowercase code `eth`, with the currency id that pins the network. */
export const ZODIA_NATIVE_BY_CHAIN_ID: Record<string, ZodiaCurrencyRef> = {
  '1': { currency: 'ETH', currencyId: 'eth-eth' },
  '11155111': { currency: 'eth', currencyId: 'eth-Seth' },
};

export function chainIdOfNative(native: ZodiaCurrencyRef): bigint | undefined {
  const entry = Object.entries(ZODIA_NATIVE_BY_CHAIN_ID).find(([, ref]) => ref.currencyId === native.currencyId);
  return entry ? BigInt(entry[0]) : undefined;
}

export function parseCurrencyRef(value: string, name: string): ZodiaCurrencyRef {
  const [currency, currencyId, ...rest] = value.split(':').map(s => s.trim());
  if (!currency || !currencyId || rest.length) throw new Error(`${name} must be CODE:currency-id, got '${value}'`);
  return { currency, currencyId };
}

/** `0xContract=CODE:currency-id,0xOther=CODE:currency-id` */
export function parseTokenCurrencies(value: string | undefined): Map<string, ZodiaCurrencyRef> {
  const tokens = new Map<string, ZodiaCurrencyRef>();
  for (const entry of (value ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [contract, ref, ...extra] = entry.split('=').map(s => s.trim());
    if (!contract || !ref || extra.length || !/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new Error(`ZODIA_TOKEN_CURRENCIES entry must be 0xContract=CODE:currency-id, got '${entry}'`);
    }
    if (tokens.has(contract.toLowerCase())) throw new Error(`ZODIA_TOKEN_CURRENCIES maps ${contract} twice`);
    tokens.set(contract.toLowerCase(), parseCurrencyRef(ref, `ZODIA_TOKEN_CURRENCIES entry for ${contract}`));
  }
  return tokens;
}

function pem(inline: string | undefined, path: string | undefined): string | undefined {
  if (inline) return inline.replace(/\\n/g, '\n');
  if (path) return fs.readFileSync(path, 'utf8');
  return undefined;
}

function positiveMs(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of milliseconds, got '${raw}'`);
  return value;
}

export function createZodiaAppConfig(): ZodiaAppConfig {
  const baseUrl = process.env.ZODIA_BASE_URL || ZODIA_UAT_URL;
  const companyId = process.env.ZODIA_COMPANY_ID;
  const submitterId = process.env.ZODIA_SUBMITTER_ID;
  const companyPrivateKey = pem(process.env.ZODIA_COMPANY_PRIVATE_KEY, process.env.ZODIA_COMPANY_PRIVATE_KEY_PATH);
  const makerPrivateKey = pem(process.env.ZODIA_MAKER_PRIVATE_KEY, process.env.ZODIA_MAKER_PRIVATE_KEY_PATH);
  const nativeEnv = process.env.ZODIA_NATIVE_CURRENCY;
  const pollIntervalMs = positiveMs('ZODIA_POLL_INTERVAL_MS', process.env.ZODIA_POLL_INTERVAL_MS, 15_000);
  const maxPollIntervalMs = positiveMs('ZODIA_MAX_POLL_INTERVAL_MS', process.env.ZODIA_MAX_POLL_INTERVAL_MS, 300_000);
  const makerPollIntervalMs = positiveMs('ZODIA_MAKER_POLL_INTERVAL_MS', process.env.ZODIA_MAKER_POLL_INTERVAL_MS, 2_000);

  if (!companyId || !submitterId) throw new Error('ZODIA_COMPANY_ID and ZODIA_SUBMITTER_ID are required for PROVIDER_TYPE=zodia');
  if (!companyPrivateKey) throw new Error('ZODIA_COMPANY_PRIVATE_KEY or ZODIA_COMPANY_PRIVATE_KEY_PATH is required for PROVIDER_TYPE=zodia');
  if (!makerPrivateKey) throw new Error('ZODIA_MAKER_PRIVATE_KEY or ZODIA_MAKER_PRIVATE_KEY_PATH is required for PROVIDER_TYPE=zodia');

  const native = nativeEnv ? parseCurrencyRef(nativeEnv, 'ZODIA_NATIVE_CURRENCY') : undefined;
  const tokens = parseTokenCurrencies(process.env.ZODIA_TOKEN_CURRENCIES);
  return { baseUrl, companyId, submitterId, companyPrivateKey, makerPrivateKey, native, tokens, pollIntervalMs, maxPollIntervalMs, makerPollIntervalMs };
}
