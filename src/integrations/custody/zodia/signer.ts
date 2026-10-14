import {
  AbstractSigner, Interface, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField, formatUnits,
} from 'ethers';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { ZODIA_SERVICE, ZodiaApiError, ZodiaClient, ZodiaInstruction, ZodiaParty, ZodiaServiceRequest } from './client';
import { ZodiaAppConfig, ZodiaCurrencyRef } from './config';
import { ZodiaChainProvider } from './chain-provider';
import { currentIdempotencyKey, nextRequestOrdinal } from '../../../services/custody/idempotency-scope';

/** The slice of ZodiaClient the provider and signer use, so tests can stand in for it. */
export type ZodiaApi = Pick<ZodiaClient,
  'wallets' | 'currencies' | 'addresses' | 'transactions' | 'beneficiaryAddresses'
  | 'serviceRequests' | 'createServiceRequest' | 'submitServiceRequest' | 'pendingInstruction' | 'confirmAsMaker'>;

const ERC20 = new Interface(['function transfer(address to, uint256 amount)']);
const KNOWN_REFUSALS = new Interface([
  'function transferFrom(address from, address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function burn(address from, uint256 amount)',
  'function burnFrom(address account, uint256 amount)',
]);

/** A request that ended without moving anything; the withdrawal and expiry spellings are accepted as well. */
const SERVICE_REQUEST_FAILED = new Set([
  'CONFIRMATION TIMEOUT', 'APPROVAL TIMEOUT', 'REJECTED BY AUTHORISER', 'REJECTED BY SYSTEM',
  'CANCELLED', 'CANCELED', 'WITHDRAWN', 'EXPIRED', 'REJECTED',
]);
const TRANSFER_FAILED = new Set(['FAILED', 'REJECTED BY SYSTEM', 'REJECTED', 'CANCELLED', 'CANCELED', 'EXPIRED']);
/** Submitted and waiting for the maker. PENDING CONFIRMATION is what Zodia documents; SUBMITTED is accepted as well. */
const AWAITING_MAKER = new Set(['PENDING CONFIRMATION', 'SUBMITTED']);
/** Nobody signed it, so nothing moved: such a request may be raised again. */
const NOTHING_SIGNED = 'CONFIRMATION TIMEOUT';
/** A maker has 120 seconds from submit to confirm. */
const MAKER_WINDOW_MS = 110_000;
/** A fixed namespace for the adapter's end-to-end ids. */
const END_TO_END_NAMESPACE = 'f1b0c6de-3f1a-5a8e-9d2c-7b4e5a6c8d90';

/** What the signer needs from its provider beyond the API: our own wallets by address, and currency decimals. */
export interface ZodiaWallets {
  native: ZodiaCurrencyRef;
  walletIdOf(address: string): Promise<string | undefined>;
  decimalsOf(currency: ZodiaCurrencyRef): Promise<number | undefined>;
}

/** What the adapter asks Zodia to move, which the maker confirmation must match. */
export interface TransferIntent {
  walletId: string;
  currency: ZodiaCurrencyRef;
  destination: ZodiaParty;
  /** smallest unit */
  amount: string;
  decimals: number | undefined;
  /** the end-to-end id of the first attempt; a later attempt derives its own (endToEndIdOfAttempt) */
  endToEndId: string;
}

/**
 * Zodia takes a service request's endToEndId as a UUID. The operation's
 * idempotency key, the request's position among those the operation raises,
 * and what is moved become one deterministically: the operation run again
 * finds the requests it raised, and two transfers of one operation — even two
 * identical ones — get their own.
 */
export function endToEndIdOf(idempotencyKey: string, ordinal: number, walletId: string, currencyId: string, destination: ZodiaParty, amount: string): string {
  return uuidv5([idempotencyKey, ordinal, walletId, currencyId, `${destination.type}:${destination.value}`, amount].join('|'), END_TO_END_NAMESPACE);
}

/** A request that timed out unsigned is raised again under the next attempt's id. */
export function endToEndIdOfAttempt(endToEndId: string, attempt: number): string {
  return attempt === 0 ? endToEndId : uuidv5(`${endToEndId}#${attempt}`, END_TO_END_NAMESPACE);
}

/**
 * Zodia has no raw signing and no contract calls: its HSM signs only service
 * requests a maker raised and an authoriser approved. This signer translates
 * sendTransaction into a Service Desk transfer, native or of an ERC-20 Zodia
 * lists, confirms it as maker, and follows it until Zodia posts it on chain or
 * ends it. It never approves as authoriser; a human does that in Zodia, and
 * however long that takes, only Zodia's own statuses end the wait (Zodia
 * times a request out itself). Anything else (deploy, mint, burn, approve) is
 * refused rather than mis-sent.
 */
export class ZodiaSigner extends AbstractSigner {

  /** why the maker confirmation of a request was withheld, to explain its timeout */
  private readonly withheld = new Map<string, string>();

  constructor(
    provider: Provider,
    private readonly api: ZodiaApi,
    private readonly config: ZodiaAppConfig,
    private readonly wallets: ZodiaWallets,
    private readonly walletId: string,
    private readonly address: string,
  ) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider): ZodiaSigner {
    return new ZodiaSigner(provider, this.api, this.config, this.wallets, this.walletId, this.address);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const target = typeof tx.to === 'string' ? tx.to : await (tx.to as { getAddress(): Promise<string> } | null | undefined)?.getAddress?.();
    if (!target) throw new Error('Zodia signer: contract deployment is not supported; Zodia moves listed currencies only');

    const { currency, to, amount } = this.translate(target, tx);
    const destination = await this.destination(to);
    // a blank key (the skeleton encodes a missing header as '') cannot be resumed
    const key = currentIdempotencyKey() || randomUUID();
    // a replay reproduces the ordinals only while an operation raises its requests one after another, as the token standards do today
    const ordinal = nextRequestOrdinal() ?? 0;
    const intent: TransferIntent = {
      walletId: this.walletId, currency, destination, amount,
      decimals: await this.wallets.decimalsOf(currency),
      endToEndId: endToEndIdOf(key, ordinal, this.walletId, currency.currencyId, destination, amount),
    };

    const request = await this.raiseOrResume(intent);
    const settled = await this.settle(request, intent);
    // ethers Contract re-wraps this response on the provider, so the receipt must come from the provider
    if (this.provider instanceof ZodiaChainProvider) {
      this.provider.recordSettled(settled.hash, { status: 1, from: this.address, timestamp: settled.timestamp });
    }
    return { hash: settled.hash, wait: async () => this.provider!.waitForTransaction(settled.hash) } as unknown as TransactionResponse;
  }

  /**
   * The request raised for this transfer before, taken as far as the maker
   * goes — a process that stopped between creating and confirming left it
   * waiting for a step only the maker can take — or a new one. A request that
   * timed out unsigned moved nothing, so the next attempt is raised under its
   * own end-to-end id; any other outcome is followed, never raised again.
   */
  private async raiseOrResume(intent: TransferIntent): Promise<ZodiaServiceRequest> {
    for (let attempt = 0; ; attempt++) {
      const endToEndId = endToEndIdOfAttempt(intent.endToEndId, attempt);
      const [known] = await this.retrying(() => this.api.serviceRequests({ serviceIds: [ZODIA_SERVICE.transfer], endToEndIds: [endToEndId] }));
      if (known?.status === NOTHING_SIGNED) continue;
      if (known) {
        if (known.status === 'DRAFT') {
          await this.api.submitServiceRequest(known.requestId);
          await this.confirmAsMaker(known.requestId, intent);
        } else if (AWAITING_MAKER.has(known.status)) {
          await this.confirmAsMaker(known.requestId, intent);
        }
        return known;
      }
      const created = await this.api.createServiceRequest(ZODIA_SERVICE.transfer, {
        amount: intent.amount,
        sender: { type: 'WALLETID', value: intent.walletId },
        currency: intent.currency.currency,
        currencyId: intent.currency.currencyId,
        destination: intent.destination,
        subtractFee: false,
      }, endToEndId);
      await this.api.submitServiceRequest(created.requestId);
      await this.confirmAsMaker(created.requestId, intent);
      return { requestId: created.requestId, serviceId: ZODIA_SERVICE.transfer, endToEndId, status: 'PENDING AUTHORISATION', entityId: created.pluginDetail?.entityId };
    }
  }

  private translate(target: string, tx: TransactionRequest): { currency: ZodiaCurrencyRef; to: string; amount: string } {
    const data = tx.data && tx.data !== '0x' ? String(tx.data) : undefined;
    if (!data) return { currency: this.wallets.native, to: target, amount: BigInt(tx.value ?? 0n).toString() };

    const call = ERC20.parseTransaction({ data });
    if (!call) {
      const refused = KNOWN_REFUSALS.parseTransaction({ data });
      throw new Error(`Zodia signer: ${refused?.signature ?? `selector ${data.slice(0, 10)}`} is not supported; Zodia offers transfers of listed currencies, not contract calls`);
    }
    if (tx.value && BigInt(tx.value) !== 0n) throw new Error('Zodia signer: a token transfer cannot also carry value');
    const currency = this.config.tokens.get(target.toLowerCase());
    if (!currency) throw new Error(`Zodia signer: token ${target} is not mapped to a Zodia currency; add it to ZODIA_TOKEN_CURRENCIES once Zodia lists it`);
    return { currency, to: String(call.args[0]), amount: (call.args[1] as bigint).toString() };
  }

  /**
   * Zodia moves value only to one of the company's own wallets or to an
   * address whitelisted on this chain for outgoing transfers; anything else is
   * refused here rather than by Zodia after the request is raised.
   */
  private async destination(to: string): Promise<ZodiaParty> {
    const own = await this.wallets.walletIdOf(to);
    if (own) return { type: 'WALLETID', value: own };
    const chain = this.wallets.native.currencyId;
    const beneficiary = (await this.api.beneficiaryAddresses({ addresses: [to], blockchainIds: [chain], statuses: ['ACTIVE'] }))
      .find(b => b.address.toLowerCase() === to.toLowerCase() && b.blockchainId === chain
        && (b.addressPurpose ?? []).some(p => p === 'OUTGOING' || p === 'BIDIRECTIONAL'));
    if (beneficiary) return { type: 'BENEFICIARYADDRESSID', value: beneficiary.cryptoAddressId };
    throw new Error(`Zodia signer: ${to} is neither a wallet of this company nor an active outgoing beneficiary address on ${chain}; whitelist it in Zodia before transferring`);
  }

  /**
   * Steps 3 and 4 of the service desk flow, inside the maker's 120-second
   * window: fetch the HSM instruction and sign it — only when it states what
   * was submitted. Otherwise the confirmation is withheld: the request then
   * times out in Zodia, and its status ends the operation. Transient errors
   * are retried within the window.
   */
  private async confirmAsMaker(requestId: string, intent: TransferIntent): Promise<void> {
    const deadline = Date.now() + MAKER_WINDOW_MS;
    let wait = this.config.makerPollIntervalMs;
    while (Date.now() < deadline) {
      try {
        const instruction = await this.api.pendingInstruction(requestId);
        const single = Array.isArray(instruction) ? instruction[0] : instruction;
        if (single) {
          const mismatch = instructionMismatch(single, intent);
          if (mismatch) {
            this.withheld.set(requestId, mismatch);
            return;
          }
          await this.api.confirmAsMaker(requestId, single as ZodiaInstruction);
          return;
        }
      } catch (e) {
        if (!isTransient(e)) throw e;
      }
      await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
      wait *= 2;
    }
    this.withheld.set(requestId, `no instruction for the maker to confirm appeared within ${MAKER_WINDOW_MS}ms`);
  }

  /**
   * One request at a time, slower each time up to the maximum interval, until
   * Zodia posts the transfer on chain (its hash) or ends it. Transient errors
   * (network, 5xx, 429) are retried; any other error ends the wait at once.
   */
  private async settle(request: ZodiaServiceRequest, intent: TransferIntent): Promise<{ hash: string; timestamp: number }> {
    let wait = this.config.pollIntervalMs;
    let entityId = request.entityId;
    let since = request.createdAt;
    for (;;) {
      try {
        const [current] = await this.api.serviceRequests({ serviceIds: [ZODIA_SERVICE.transfer], requestIds: [request.requestId] });
        if (current) {
          if (SERVICE_REQUEST_FAILED.has(current.status)) throw new ZodiaTransferEnded(this.endedReason(current));
          entityId = entityId ?? current.entityId;
          since = since ?? current.createdAt;
          if (entityId) {
            const transfer = (await this.api.transactions({ walletIds: [intent.walletId], currenciesIds: [intent.currency.currencyId], ...(since ? { fromDate: since } : {}) }))
              .find(t => t.id === entityId);
            if (transfer && TRANSFER_FAILED.has(transfer.status)) throw new ZodiaTransferEnded(`Zodia transfer ${entityId} ended ${transfer.status}`);
            if (transfer?.ledgerRef) {
              const at = transfer.createdAt ? Date.parse(transfer.createdAt) : Date.now();
              return { hash: transfer.ledgerRef, timestamp: Math.floor(at / 1000) };
            }
          }
        }
      } catch (e) {
        if (e instanceof ZodiaTransferEnded) throw e;
        if (!isTransient(e)) {
          throw new Error(`Zodia service request ${request.requestId} cannot be followed: ${(e as Error).message}; it may still execute in Zodia, do not resubmit`);
        }
      }
      await sleep(wait);
      wait = Math.min(wait * 2, this.config.maxPollIntervalMs);
    }
  }

  /** A read that a transient error does not end: retried after a short pause. */
  private async retrying<T>(read: () => Promise<T>): Promise<T> {
    let wait = this.config.makerPollIntervalMs;
    for (;;) {
      try {
        return await read();
      } catch (e) {
        if (!isTransient(e)) throw e;
        await sleep(wait);
        wait = Math.min(wait * 2, this.config.maxPollIntervalMs);
      }
    }
  }

  private endedReason(request: ZodiaServiceRequest): string {
    const withheld = this.withheld.get(request.requestId);
    return `Zodia service request ${request.requestId} ended ${request.status}${withheld ? ` (maker confirmation withheld: ${withheld})` : ''}`;
  }

  async signTransaction(): Promise<string> {
    throw new Error('Zodia signer: raw transaction signing is not supported; the HSM signs only approved service requests');
  }

  async signMessage(): Promise<string> {
    throw new Error('Zodia signer: raw message signing is not supported');
  }

  async signTypedData(_d: TypedDataDomain, _t: Record<string, TypedDataField[]>, _v: Record<string, unknown>): Promise<string> {
    throw new Error('Zodia signer: typed-data signing is not supported');
  }
}

class ZodiaTransferEnded extends Error {}

/** Worth asking again: Zodia's 5xx and 429, and a request that never reached it. */
function isTransient(e: unknown): boolean {
  if (e instanceof ZodiaApiError) return e.status >= 500 || e.status === 429;
  if (!(e instanceof Error)) return false;
  const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
  return e.message === 'fetch failed'
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '');
}

const AMOUNT_KEY = /amount|quantity/i;

/** A scalar of the instruction: the keys leading to it, its value, and the objects that hold it, outermost first. */
type Leaf = { keys: string[]; value: string; parents: object[] };

/**
 * Whether the HSM instruction states what the adapter submitted. Zodia does
 * not document the instruction's fields, so the check is shape-tolerant but
 * bound to structure, and fails closed:
 *  - it must carry at least one amount field (a key naming an amount or a
 *    quantity, or the value of an object so named), and every amount field
 *    must hold the submitted amount — in the
 *    smallest unit or, when the decimals are known, in decimal form;
 *  - the object holding that amount must also state, among its own fields or
 *    those of the objects nested in it, the source wallet, the currency id and
 *    the destination (wallet id or beneficiary address id) — so they describe
 *    one payment, not values scattered over unrelated parts of the instruction.
 * The end-to-end id is matched on the request itself, which is found by it.
 */
export function instructionMismatch(instruction: ZodiaInstruction, intent: TransferIntent): string | undefined {
  const leaves: Leaf[] = [];
  const walk = (node: unknown, keys: string[], parents: object[]): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) return node.forEach(v => walk(v, keys, parents));
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...keys, k], [...parents, node as object]);
      return;
    }
    leaves.push({ keys, value: String(node).toLowerCase(), parents });
  };
  walk(instruction.request, [], []);

  const amounts = new Set([intent.amount]);
  if (intent.decimals !== undefined) {
    const decimal = formatUnits(BigInt(intent.amount), intent.decimals);
    amounts.add(decimal).add(decimal.replace(/\.0$/, ''));
  }
  // an amount is a field named so, or the scalar of an object named so (`amount: { value }`)
  const amountDepth = (l: Leaf) => AMOUNT_KEY.test(l.keys[l.keys.length - 1] ?? '') ? 1
    : AMOUNT_KEY.test(l.keys[l.keys.length - 2] ?? '') && /^(value|amount|quantity)$/i.test(l.keys[l.keys.length - 1] ?? '') ? 2 : 0;
  const amountLeaves = leaves.filter(l => amountDepth(l) > 0);
  if (amountLeaves.length === 0) return 'the instruction states no amount';
  const other = amountLeaves.find(l => !amounts.has(l.value));
  if (other) return `the instruction states amount ${other.value} (${other.keys.join('.')}), submitted ${intent.amount}`;

  // the payment is the object holding the amount field
  const first = amountLeaves[0]!;
  const payment = first.parents[first.parents.length - amountDepth(first)]!;
  const inPayment = leaves.filter(l => l.parents.includes(payment)).map(l => l.value);
  const states = (v: string) => inPayment.includes(v.toLowerCase());
  const missing = [
    !states(intent.walletId) && `source wallet ${intent.walletId}`,
    !states(intent.currency.currencyId) && `currency ${intent.currency.currencyId}`,
    !states(intent.destination.value) && `destination ${intent.destination.value}`,
  ].filter(Boolean);
  return missing.length ? `the instruction's payment does not state ${missing.join(', ')}` : undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
