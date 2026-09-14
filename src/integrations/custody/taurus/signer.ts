import {
  AbstractSigner, Interface, Provider, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField,
} from 'ethers';
import { TaurusClient, ContractArg, ContractArgValue, ContractCall, TaurusRequest, transactionHashOf } from './client';
import { TaurusAppConfig } from './config';

/**
 * Taurus signs only approved, structured requests in its HSM — there is no
 * raw-hash or raw-calldata signing. This signer therefore TRANSLATES
 * sendTransaction into PROTECT outgoing requests: calldata is decoded against
 * the token-operation ABI the adapter actually uses, submitted as a contract
 * call (or a native transfer), approved with the operator key when one is
 * configured (otherwise the request waits for a human approver), and the
 * request pipeline (APPROVED -> HSM_SIGNED -> BROADCASTING -> CONFIRMED) is
 * polled for the transaction hash. Calldata outside the known ABI is
 * rejected with an explicit error rather than mis-sent.
 */

const KNOWN_ABI = new Interface([
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function mint(address to, uint256 amount)',
  'function burn(uint256 amount)',
  'function burn(address from, uint256 amount)',
  'function burnFrom(address account, uint256 amount)',
]);

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

    const data = tx.data && tx.data !== '0x' ? String(tx.data) : undefined;
    let request: TaurusRequest;
    if (!data) {
      const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
      if (!toWhitelistedAddressId) {
        throw new Error(`Taurus signer: ${to} is not a whitelisted address in PROTECT — whitelist it before transacting`);
      }
      request = await this.client.createTransferRequest({
        fromAddressId: this.addressId,
        toWhitelistedAddressId,
        amount: (tx.value ?? 0n).toString(),
        comment: 'finp2p adapter transfer',
      });
    } else {
      const parsed = KNOWN_ABI.parseTransaction({ data });
      if (!parsed) {
        throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not in the known token-operation ABI — PROTECT accepts structured calls only`);
      }
      if (parsed.signature === 'transfer(address,uint256)') {
        // PROTECT's native ERC20 transfer: the token must be a registered
        // (whitelisted + approved) currency; PROTECT builds and signs the
        // token call itself. Live-verified against the UAT.
        const currency = await this.client.findCurrencyByContract(to);
        if (!currency) {
          throw new Error(`Taurus signer: token ${to} is not a registered PROTECT currency — whitelist and approve the contract before transferring`);
        }
        request = await this.client.createAddressToAddressTransfer({
          fromAddress: this.address,
          toAddress: String(parsed.args[0]),
          amount: (parsed.args[1] as bigint).toString(),
          currency: currency.symbol,
          comment: 'finp2p adapter token transfer',
        });
      } else {
        // Other token operations go through the generic contract-call request,
        // whose destination must be in the whitelisted-ADDRESSES registry
        // (contracts/call does not resolve whitelisted-contract ids).
        const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
        if (!toWhitelistedAddressId) {
          throw new Error(`Taurus signer: contract ${to} is not in the PROTECT whitelisted-addresses registry — contract calls require the contract whitelisted as an address`);
        }
        request = await this.client.createContractCallRequest({
          fromAddressId: this.addressId,
          toWhitelistedAddressId,
          method: toContractCall(parsed),
          amount: tx.value !== undefined && tx.value !== null ? tx.value.toString() : undefined,
          gasLimit: tx.gasLimit?.toString(),
          comment: 'finp2p adapter contract call',
        });
      }
    }

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

function toArgValue(value: unknown): ContractArgValue {
  if (Array.isArray(value)) return { composite: value.map(toArgValue) };
  if (typeof value === 'bigint' || typeof value === 'boolean' || typeof value === 'number') {
    return { primitive: value.toString() };
  }
  return { primitive: String(value) };
}

function toContractCall(parsed: NonNullable<ReturnType<Interface['parseTransaction']>>): ContractCall {
  const args: ContractArg[] = parsed.fragment.inputs.map((input, i) => ({
    name: input.name || `arg_${i + 1}`,
    type: input.type,
    value: toArgValue(parsed.args[i]),
  }));
  return { functionSignature: parsed.signature, args };
}

/** Decode calldata into PROTECT's structured ContractCall ({name, type,
 *  value: {primitive | composite}} per argument); unknown selectors are
 *  refused — mis-translating a call is worse than failing it. */
export function decodeToContractCall(data: string): ContractCall {
  const parsed = KNOWN_ABI.parseTransaction({ data });
  if (!parsed) {
    throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not in the known token-operation ABI — PROTECT accepts structured calls only`);
  }
  return toContractCall(parsed);
}
