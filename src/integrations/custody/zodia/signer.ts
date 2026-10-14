import {
  AbstractSigner, Interface, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField, formatUnits,
} from 'ethers';
import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { ZODIA_SERVICE, ZodiaApiError, ZodiaClient, ZodiaInstruction, ZodiaParty, ZodiaServiceRequest } from './client';
import { ZodiaAppConfig, ZodiaCurrencyRef } from './config';
import { ZodiaChainProvider } from './chain-provider';
import { currentIdempotencyKey } from '../../../services/custody/idempotency-scope';

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

const SERVICE_REQUEST_FAILED = new Set(['CONFIRMATION TIMEOUT', 'APPROVAL TIMEOUT', 'REJECTED BY AUTHORISER', 'REJECTED BY SYSTEM']);
const TRANSFER_FAILED = new Set(['FAILED', 'REJECTED BY SYSTEM']);
/** Submitted and waiting for the maker. PENDING CONFIRMATION is what Zodia documents; SUBMITTED is accepted as well. */
const AWAITING_MAKER = new Set(['PENDING CONFIRMATION', 'SUBMITTED']);
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
  endToEndId: string;
}

/**
 * Zodia takes a service request's endToEndId as a UUID. The idempotency key
 * of the operation, with what is moved, becomes one deterministically: the
 * operation run again finds the request it raised, and a second transfer in
 * the same operation gets its own.
 */
export function endToEndIdOf(idempotencyKey: string, walletId: string, currencyId: string, destination: ZodiaParty, amount: string): string {
  return uuidv5([idempotencyKey, walletId, currencyId, `${destination.type}:${destination.value}`, amount].join('|'), END_TO_END_NAMESPACE);
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
    const intent: TransferIntent = {
      walletId: this.walletId, currency, destination, amount,
      decimals: await this.wallets.decimalsOf(currency),
      endToEndId: endToEndIdOf(key, this.walletId, currency.currencyId, destination, amount),
    };

    const requestId = await this.raiseOrResume(intent);
    const settled = await this.settle(requestId, intent);
    // ethers Contract re-wraps this response on the provider, so the receipt must come from the provider
    if (this.provider instanceof ZodiaChainProvider) {
      this.provider.recordSettled(settled.hash, { status: 1, from: this.address, timestamp: settled.timestamp });
    }
    return { hash: settled.hash, wait: async () => this.provider!.waitForTransaction(settled.hash) } as unknown as TransactionResponse;
  }

  /**
   * The request raised under this end-to-end id before, taken as far as the
   * maker goes — a process that stopped between creating and confirming left
   * it waiting for a step only the maker can take — or a new one.
   */
  private async raiseOrResume(intent: TransferIntent): Promise<string> {
    const [known] = await this.api.serviceRequests({ serviceIds: [ZODIA_SERVICE.transfer], endToEndIds: [intent.endToEndId] });
    if (known) {
      if (known.status === 'DRAFT') {
        await this.api.submitServiceRequest(known.requestId);
        await this.confirmAsMaker(known.requestId, intent);
      } else if (AWAITING_MAKER.has(known.status)) {
        await this.confirmAsMaker(known.requestId, intent);
      }
      return known.requestId;
    }
    const created = await this.api.createServiceRequest(ZODIA_SERVICE.transfer, {
      amount: intent.amount,
      sender: { type: 'WALLETID', value: intent.walletId },
      currency: intent.currency.currency,
      currencyId: intent.currency.currencyId,
      destination: intent.destination,
      subtractFee: false,
    }, intent.endToEndId);
    await this.api.submitServiceRequest(created.requestId);
    await this.confirmAsMaker(created.requestId, intent);
    return created.requestId;
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

  /** Zodia moves value only to one of the company's own wallets or to an active outgoing beneficiary address. */
  private async destination(to: string): Promise<ZodiaParty> {
    const own = await this.wallets.walletIdOf(to);
    if (own) return { type: 'WALLETID', value: own };
    const beneficiary = (await this.api.beneficiaryAddresses({ addresses: [to], statuses: ['ACTIVE'] }))
      .find(b => b.address.toLowerCase() === to.toLowerCase() && (b.addressPurpose ?? ['OUTGOING']).some(p => p === 'OUTGOING' || p === 'BIDIRECTIONAL'));
    if (beneficiary) return { type: 'BENEFICIARYADDRESSID', value: beneficiary.cryptoAddressId };
    throw new Error(`Zodia signer: ${to} is neither a wallet of this company nor an active outgoing beneficiary address; whitelist it in Zodia before transferring`);
  }

  /**
   * Steps 3 and 4 of the service desk flow, inside the maker's 120-second
   * window: fetch the HSM instruction and sign it — only when it states what
   * was submitted. Otherwise the confirmation is withheld: the request then
   * times out in Zodia, and its status ends the operation.
   */
  private async confirmAsMaker(requestId: string, intent: TransferIntent): Promise<void> {
    const deadline = Date.now() + MAKER_WINDOW_MS;
    let wait = this.config.makerPollIntervalMs;
    while (Date.now() < deadline) {
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
      await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
      wait *= 2;
    }
    this.withheld.set(requestId, `no instruction for the maker to confirm appeared within ${MAKER_WINDOW_MS}ms`);
  }

  /**
   * One request at a time, slower each time up to the maximum interval, until
   * Zodia posts the transfer on chain (its hash) or ends it. Network errors,
   * 5xx and 429 are retried; any other Zodia refusal ends the wait at once.
   */
  private async settle(requestId: string, intent: TransferIntent): Promise<{ hash: string; timestamp: number }> {
    let wait = this.config.pollIntervalMs;
    let entityId: string | undefined;
    for (;;) {
      try {
        const [request] = await this.api.serviceRequests({ serviceIds: [ZODIA_SERVICE.transfer], requestIds: [requestId] });
        if (request) {
          if (SERVICE_REQUEST_FAILED.has(request.status)) throw new ZodiaTransferEnded(this.endedReason(requestId, request));
          entityId = entityId ?? request.entityId;
          if (entityId) {
            const transfer = (await this.api.transactions({ walletIds: [intent.walletId], currenciesIds: [intent.currency.currencyId] })).find(t => t.id === entityId);
            if (transfer && TRANSFER_FAILED.has(transfer.status)) throw new ZodiaTransferEnded(`Zodia transfer ${entityId} ended ${transfer.status}`);
            if (transfer?.ledgerRef) {
              const at = transfer.createdAt ? Date.parse(transfer.createdAt) : Date.now();
              return { hash: transfer.ledgerRef, timestamp: Math.floor(at / 1000) };
            }
          }
        }
      } catch (e) {
        if (e instanceof ZodiaTransferEnded) throw e;
        if (e instanceof ZodiaApiError && !(e.status >= 500 || e.status === 429)) {
          throw new Error(`Zodia service request ${requestId} cannot be followed: ${e.message}; it may still execute in Zodia, do not resubmit`);
        }
      }
      await sleep(wait);
      wait = Math.min(wait * 2, this.config.maxPollIntervalMs);
    }
  }

  private endedReason(requestId: string, request: ZodiaServiceRequest): string {
    const withheld = this.withheld.get(requestId);
    return `Zodia service request ${requestId} ended ${request.status}${withheld ? ` (maker confirmation withheld: ${withheld})` : ''}`;
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

/**
 * Whether the HSM instruction states what the adapter submitted. Zodia does
 * not document the instruction's fields, so each expected value must appear
 * somewhere in it: the source wallet, the currency id, the destination (wallet
 * id or beneficiary address id), the amount (smallest unit or, when the
 * decimals are known, its decimal form). A missing value is a mismatch. The
 * end-to-end id is matched on the request itself, which is found by it.
 */
export function instructionMismatch(instruction: ZodiaInstruction, intent: TransferIntent): string | undefined {
  const values = new Set<string>();
  const collect = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(collect);
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).forEach(collect);
    values.add(String(v).toLowerCase());
  };
  collect(instruction.request);
  const has = (...candidates: string[]) => candidates.some(c => values.has(c.toLowerCase()));

  const amounts = [intent.amount];
  if (intent.decimals !== undefined) {
    const decimal = formatUnits(BigInt(intent.amount), intent.decimals);
    amounts.push(decimal, decimal.replace(/\.0$/, ''));
  }
  const missing = [
    !has(intent.walletId) && `source wallet ${intent.walletId}`,
    !has(intent.currency.currencyId) && `currency ${intent.currency.currencyId}`,
    !has(intent.destination.value) && `destination ${intent.destination.value}`,
    !has(...amounts) && `amount ${intent.amount}`,
  ].filter(Boolean);
  return missing.length ? `the instruction does not state ${missing.join(', ')}` : undefined;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
