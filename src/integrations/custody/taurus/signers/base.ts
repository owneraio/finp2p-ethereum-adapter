import {
  AbstractSigner, Provider, TransactionDescription, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField,
} from 'ethers';
import { ERC20__factory } from '@owneraio/finp2p-ethereum-erc20-plugin';
import { TaurusClient, TaurusRequest, transactionHashOf } from '../client';
import { TaurusAppConfig } from '../config';

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
 * Either way the request is approved with the operator key when one is
 * configured (otherwise it waits for a human approver) and the request
 * pipeline (APPROVED -> HSM_SIGNED -> BROADCASTING -> CONFIRMED) is polled
 * for the transaction hash. Calldata outside the frozen contract models is
 * rejected with an explicit error rather than mis-sent.
 */

export const TOKEN_CONTRACT_ABI = ERC20__factory.createInterface();

const TERMINAL_FAIL = new Set(['REJECTED', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED']);

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
  protected abstract createRequest(to: string, parsed: TransactionDescription | undefined, tx: TransactionRequest): Promise<TaurusRequest>;

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
    const request = await this.createRequest(to, parsed, tx);

    if (this.config.operatorPrivateKey) {
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
