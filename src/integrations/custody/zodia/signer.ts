import {
  AbstractSigner, Interface, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField,
} from 'ethers';
import { randomUUID } from 'crypto';
import { ZODIA_SERVICE, ZodiaClient, ZodiaInstruction, ZodiaParty } from './client';
import { ZodiaAppConfig, ZodiaCurrencyRef } from './config';

/** The slice of ZodiaClient the provider and signer use, so tests can stand in for it. */
export type ZodiaApi = Pick<ZodiaClient,
  'addresses' | 'transactions' | 'beneficiaryAddresses'
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
const MAKER_WINDOW_MS = 110_000;

/** What the signer needs from its provider beyond the API: our own wallets, by address. */
export interface ZodiaWallets {
  native: ZodiaCurrencyRef;
  walletIdOf(address: string): Promise<string | undefined>;
}

/**
 * Zodia has no raw signing and no contract calls: its HSM signs only service
 * requests a maker raised and an authoriser approved. This signer therefore
 * translates sendTransaction into a Service Desk transfer, native or of an
 * ERC-20 Zodia lists, confirms it as maker and waits for the chain hash. It
 * never approves as authoriser; a human does that in Zodia. Anything else
 * (deploy, mint, burn, approve) is refused rather than mis-sent.
 */
export class ZodiaSigner extends AbstractSigner {

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
    const endToEndId = `finp2p-${randomUUID()}`;
    const created = await this.api.createServiceRequest(ZODIA_SERVICE.transfer, {
      amount,
      sender: { type: 'WALLETID', value: this.walletId },
      currency: currency.currency,
      currencyId: currency.currencyId,
      destination,
      subtractFee: false,
    }, endToEndId);
    await this.api.submitServiceRequest(created.requestId);
    await this.confirmAsMaker(created.requestId);

    const hash = await this.waitForHash(created.requestId, currency, created.pluginDetail?.entityId);
    const onchain = await this.provider!.getTransaction(hash).catch(() => null);
    if (onchain) return onchain;
    return { hash, wait: async () => this.provider!.waitForTransaction(hash) } as unknown as TransactionResponse;
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

  private async confirmAsMaker(requestId: string): Promise<void> {
    const deadline = Date.now() + MAKER_WINDOW_MS;
    let wait = this.config.makerPollIntervalMs;
    while (Date.now() < deadline) {
      const instruction = await this.api.pendingInstruction(requestId);
      const single = Array.isArray(instruction) ? instruction[0] : instruction;
      if (single) {
        await this.api.confirmAsMaker(requestId, single as ZodiaInstruction);
        return;
      }
      await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
      wait *= 2;
    }
    throw new Error(`Zodia service request ${requestId} produced no instruction for the maker to confirm within ${MAKER_WINDOW_MS}ms`);
  }

  private async waitForHash(requestId: string, currency: ZodiaCurrencyRef, knownEntityId: string | undefined): Promise<string> {
    const deadline = Date.now() + this.config.requestTimeoutMs;
    let wait = this.config.pollIntervalMs;
    let last = 'not listed yet';
    while (Date.now() < deadline) {
      const [request] = await this.api.serviceRequests({ requestIds: [requestId] });
      if (request) {
        last = request.status;
        if (SERVICE_REQUEST_FAILED.has(request.status)) throw new Error(`Zodia service request ${requestId} ended ${request.status}`);
        const entityId = knownEntityId ?? request.entityId;
        if (entityId) {
          const transfer = (await this.api.transactions({ walletIds: [this.walletId], currenciesIds: [currency.currencyId] })).find(t => t.id === entityId);
          if (transfer && TRANSFER_FAILED.has(transfer.status)) throw new Error(`Zodia transfer ${entityId} ended ${transfer.status}`);
          if (transfer?.ledgerRef) return transfer.ledgerRef;
          if (transfer) last = `transfer ${entityId} ${transfer.status}`;
        }
      }
      await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
      wait = Math.min(wait * 2, this.config.maxPollIntervalMs);
    }
    throw new Error(`Zodia service request ${requestId} is still ${last} after ${this.config.requestTimeoutMs}ms; it will still execute if an authoriser approves it, so do not resubmit`);
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
