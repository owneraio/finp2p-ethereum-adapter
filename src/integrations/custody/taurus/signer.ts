import {
  AbstractSigner, Interface, Provider, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField, formatEther, formatUnits,
} from 'ethers';
import { TaurusClient, ContractCall, TaurusRequest } from './client';
import { TaurusAppConfig } from './config';

/**
 * Taurus signs only approved, structured requests in its HSM — there is no
 * raw-hash or raw-calldata signing. This signer therefore TRANSLATES
 * sendTransaction into PROTECT outgoing requests: calldata is decoded against
 * the token-operation ABI the adapter actually uses, submitted as a contract
 * call (or a native transfer), self-approved with the operator key, and the
 * request pipeline (APPROVED -> HSM_SIGNED -> BROADCASTING -> CONFIRMED) is
 * polled for the transaction hash. Calldata outside the known ABI is
 * rejected with an explicit error rather than mis-sent.
 */

const KNOWN_ABI = new Interface([
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function burn(address from, uint256 amount)',
  'function burnFrom(address account, uint256 amount)',
]);

const TERMINAL_OK = new Set(['BROADCASTING', 'BROADCASTED', 'CONFIRMED', 'COMPLETED']);
const TERMINAL_FAIL = new Set(['REJECTED', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED']);

export class TaurusSigner extends AbstractSigner {

  constructor(
    provider: Provider,
    private readonly client: TaurusClient,
    private readonly config: TaurusAppConfig,
    private readonly addressId: string,
    private readonly address: string,
  ) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider): TaurusSigner {
    return new TaurusSigner(provider, this.client, this.config, this.addressId, this.address);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const to = typeof tx.to === 'string' ? tx.to : await (tx.to as { getAddress(): Promise<string> })?.getAddress?.();
    if (!to) throw new Error('Taurus signer: transaction without a target is not supported (no contract deployment via PROTECT requests)');

    const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
    if (!toWhitelistedAddressId) {
      throw new Error(`Taurus signer: ${to} is not whitelisted in PROTECT — whitelist the address/contract before transacting`);
    }

    const data = tx.data && tx.data !== '0x' ? String(tx.data) : undefined;
    let request: TaurusRequest;
    if (!data) {
      request = await this.client.createTransferRequest({
        fromAddressId: this.addressId,
        toWhitelistedAddressId,
        amount: formatEther(tx.value ?? 0n),
        comment: 'finp2p adapter transfer',
      });
    } else {
      request = await this.client.createContractCallRequest({
        fromAddressId: this.addressId,
        toWhitelistedAddressId,
        method: decodeToContractCall(data),
        amount: tx.value ? formatEther(tx.value) : undefined,
        gasLimit: tx.gasLimit?.toString(),
        comment: 'finp2p adapter contract call',
      });
    }

    await this.client.approveRequests([request]);
    const hash = await this.waitForHash(request.id);
    const onchain = await this.provider!.getTransaction(hash);
    if (onchain) return onchain;
    return { hash, wait: async () => this.provider!.waitForTransaction(hash) } as unknown as TransactionResponse;
  }

  private async waitForHash(requestId: string): Promise<string> {
    const deadline = Date.now() + this.config.requestTimeoutMs;
    while (Date.now() < deadline) {
      const request = await this.client.getRequest(requestId);
      if (request.transactionHash) return request.transactionHash;
      if (TERMINAL_FAIL.has(request.status)) {
        throw new Error(`Taurus request ${requestId} ended ${request.status}`);
      }
      if (TERMINAL_OK.has(request.status) && request.transactionHash) return request.transactionHash;
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

/** Decode calldata into PROTECT's structured ContractCall; unknown selectors
 *  are refused — mis-translating a call is worse than failing it. */
export function decodeToContractCall(data: string): ContractCall {
  const parsed = KNOWN_ABI.parseTransaction({ data });
  if (!parsed) {
    throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not in the known token-operation ABI — PROTECT accepts structured calls only`);
  }
  return {
    functionSignature: parsed.signature,
    args: parsed.args.map(a => (typeof a === 'bigint' ? a.toString() : a)),
  };
}
