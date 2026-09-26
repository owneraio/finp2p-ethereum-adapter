import {
  AbstractSigner, Provider, TransactionDescription, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField,
} from 'ethers';
import { createHash } from 'crypto';
import { ERC20__factory } from '@owneraio/finp2p-ethereum-erc20-plugin';
import { TaurusClient, TaurusRequest, transactionHashOf } from '../client';
import { TaurusAppConfig } from '../config';
import { currentIdempotencyKey } from '../../../../services/custody/idempotency-scope';

/**
 * Taurus signs only approved, structured requests in its HSM — there is no
 * raw-hash or raw-calldata signing — so sendTransaction is TRANSLATED into
 * PROTECT outgoing requests. Calldata is decoded against the plugin's
 * hardhat-generated model of the frozen token contract (the same source the
 * default standard deploys from); how the decoded operation is submitted
 * depends on the configured operation mode:
 *
 *  - signers/contract-call.ts ('contract-call'): every token operation is
 *    submitted as the structured form of the token standard's contract call,
 *    like the other custody providers sign it — token standards supported.
 *  - signers/transfer-only.ts ('transfer-only'): plain ERC20 transfers only,
 *    as PROTECT-native currency transfers (the live-verified path); any other
 *    token operation is refused — token standards NOT supported.
 *
 * Before self-approval the request's signed payload is verified: its SHA-256
 * must match metadata.hash and its source, destination, function, arguments
 * and currency must equal what was submitted — a corrupted or substituted
 * request must never receive an operator signature. The request pipeline
 * (APPROVED -> HSM_SIGNED -> BROADCASTING -> CONFIRMED) is then polled for
 * the transaction hash. The adapter idempotency key rides as PROTECT's
 * externalRequestId, so a retried operation returns the original request
 * instead of creating a second live one.
 */

export const TOKEN_CONTRACT_ABI = ERC20__factory.createInterface();

const TERMINAL_FAIL = new Set([
  'REJECTED', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED',
  'PERMANENT_FAILURE', 'HSM_FAILED', 'INVALID',
]);

/** what the mode submitted, to be checked against the signed payload */
export interface RequestExpectation {
  source: string;
  /** token calls: function signature + per-argument expectation */
  fn?: string;
  args?: { address?: string; value?: string }[];
  /** plain transfers: recipient and smallest-unit amount */
  destination?: string;
  amount?: string;
  currencyId?: string;
}

export abstract class TaurusSigner extends AbstractSigner {

  constructor(
    provider: Provider,
    protected readonly client: TaurusClient,
    protected readonly config: TaurusAppConfig,
    protected readonly addressId: string,
    protected readonly address: string,
  ) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  /** map the transaction to the PROTECT request of this operation mode;
   *  parsed is the decoded token call, undefined for a native transfer */
  protected abstract createRequest(
    to: string, parsed: TransactionDescription | undefined, tx: TransactionRequest, externalRequestId: string | undefined,
  ): Promise<{ request: TaurusRequest; expected: RequestExpectation }>;

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const to = typeof tx.to === 'string' ? tx.to : await (tx.to as { getAddress(): Promise<string> })?.getAddress?.();
    if (!to) throw new Error('Taurus signer: transaction without a target is not supported (no contract deployment via PROTECT requests)');

    const data = tx.data && tx.data !== '0x' ? String(tx.data) : undefined;
    let parsed: TransactionDescription | undefined;
    if (data) {
      parsed = TOKEN_CONTRACT_ABI.parseTransaction({ data }) ?? undefined;
      if (!parsed) {
        throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not part of the frozen token-contract model — PROTECT accepts structured calls only`);
      }
    }
    const { request, expected } = await this.createRequest(to, parsed, tx, currentIdempotencyKey());

    if (this.config.operatorPrivateKey) {
      verifyRequestPayload(request, expected);
      await this.client.approveRequests([request]);
    }
    const hash = await this.waitForHash(request.id);
    const onchain = await this.provider!.getTransaction(hash);
    if (onchain) return onchain;
    return { hash, wait: async () => this.provider!.waitForTransaction(hash) } as unknown as TransactionResponse;
  }

  private async waitForHash(requestId: string): Promise<string> {
    const deadline = Date.now() + this.config.requestTimeoutMs;
    while (Date.now() < deadline) {
      const request = await this.client.getRequest(requestId);
      const hash = transactionHashOf(request);
      if (hash) return hash;
      if (TERMINAL_FAIL.has(request.status)) {
        throw new Error(`Taurus request ${requestId} ended ${request.status}`);
      }
      await new Promise(r => setTimeout(r, this.config.requestPollIntervalMs));
    }
    throw new Error(`Taurus request ${requestId} produced no transaction hash within ${this.config.requestTimeoutMs}ms`);
  }

  async signTransaction(): Promise<string> {
    throw new Error('Taurus signer: raw transaction signing is not supported — the HSM signs only approved PROTECT requests');
  }

  async signMessage(): Promise<string> {
    throw new Error('Taurus signer: raw message signing is not supported');
  }

  async signTypedData(_d: TypedDataDomain, _t: Record<string, TypedDataField[]>, _v: Record<string, unknown>): Promise<string> {
    throw new Error('Taurus signer: typed-data signing is not supported');
  }
}

type PayloadEntry = { key: string; value: unknown };
type AddressValue = { payload?: { address?: string } };
type AmountValue = { valueFrom?: string };

/** The signed payload (metadata.payloadAsString, whose SHA-256 is the
 *  metadata.hash the approval signature covers) must state exactly what was
 *  submitted; on any mismatch the request is NOT approved. */
export function verifyRequestPayload(request: TaurusRequest, expected: RequestExpectation): void {
  const refuse = (what: string): never => {
    throw new Error(`Taurus request ${request.id} failed pre-approval verification: ${what}`);
  };
  const { hash, payloadAsString } = request.metadata ?? {};
  if (!hash || !payloadAsString) refuse('metadata hash/payloadAsString missing');
  if (createHash('sha256').update(payloadAsString!, 'utf-8').digest('hex') !== hash) refuse('payload hash mismatch');

  const fields = new Map<string, unknown>((JSON.parse(payloadAsString!) as PayloadEntry[]).map(e => [e.key, e.value]));
  const addressOf = (key: string) => (fields.get(key) as AddressValue | undefined)?.payload?.address?.toLowerCase();
  const amountOf = (key: string) => (fields.get(key) as AmountValue | undefined)?.valueFrom;

  if (addressOf('source') !== expected.source) refuse(`source is ${addressOf('source')}, submitted ${expected.source}`);
  if (expected.currencyId && fields.get('currency_id') !== expected.currencyId) refuse('currency mismatch');

  if (expected.fn) {
    if (fields.get('function') !== expected.fn) refuse(`function is ${fields.get('function')}, submitted ${expected.fn}`);
    (expected.args ?? []).forEach((arg, i) => {
      const key = `arg_${i + 1}`;
      if (arg.address && addressOf(key) !== arg.address) refuse(`${key} is ${addressOf(key)}, submitted ${arg.address}`);
      if (arg.value && amountOf(key) !== arg.value) refuse(`${key} is ${amountOf(key)}, submitted ${arg.value}`);
    });
  } else {
    if (addressOf('destination') !== expected.destination) refuse(`destination is ${addressOf('destination')}, submitted ${expected.destination}`);
    if (amountOf('amount') !== expected.amount) refuse(`amount is ${amountOf('amount')}, submitted ${expected.amount}`);
  }
}
