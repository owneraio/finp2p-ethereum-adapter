import {
  AbstractSigner, Provider, TransactionDescription, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField,
} from 'ethers';
import { ERC20__factory, ERC20WithOperator__factory } from '@owneraio/finp2p-ethereum-erc20-plugin';
import { TaurusClient, ContractArg, ContractArgValue, ContractCall, TaurusRequest, transactionHashOf } from './client';
import { TaurusAppConfig } from './config';

/**
 * Taurus signs only approved, structured requests in its HSM — there is no
 * raw-hash or raw-calldata signing — so sendTransaction is TRANSLATED into
 * PROTECT outgoing requests. Calldata is decoded against the plugin's
 * hardhat-generated models of the frozen token contracts (the same source the
 * standards deploy from); how the decoded operation is submitted depends on
 * the configured operation mode:
 *
 *  - TaurusContractCallSigner ('contract-call'): every token operation is
 *    submitted as the structured form of the token standard's contract call,
 *    like the other custody providers sign it — token standards supported.
 *  - TaurusTransferOnlySigner ('transfer-only'): plain ERC20 transfers only,
 *    as PROTECT-native currency transfers (the live-verified path); any other
 *    token operation is refused — token standards NOT supported.
 *
 * Either way the request is approved with the operator key when one is
 * configured (otherwise it waits for a human approver) and the request
 * pipeline (APPROVED -> HSM_SIGNED -> BROADCASTING -> CONFIRMED) is polled
 * for the transaction hash. Calldata outside the frozen contract models is
 * rejected with an explicit error rather than mis-sent.
 */

const TOKEN_CONTRACT_ABIS = [
  ERC20__factory.createInterface(),
  ERC20WithOperator__factory.createInterface(),
];

function parseTokenCalldata(data: string): TransactionDescription | null {
  for (const abi of TOKEN_CONTRACT_ABIS) {
    const parsed = abi.parseTransaction({ data });
    if (parsed) return parsed;
  }
  return null;
}

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

  /** submit the decoded token operation as a PROTECT request */
  protected abstract tokenOperationRequest(to: string, parsed: TransactionDescription, tx: TransactionRequest): Promise<TaurusRequest>;

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
      const parsed = parseTokenCalldata(data);
      if (!parsed) {
        throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not part of the frozen token-contract models — PROTECT accepts structured calls only`);
      }
      request = await this.tokenOperationRequest(to, parsed, tx);
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

/** 'contract-call' mode: the token standard's contract call IS the operation;
 *  it is submitted structurally against the whitelisted-ADDRESSES registry
 *  (contracts/call does not resolve whitelisted-contract ids). */
export class TaurusContractCallSigner extends TaurusSigner {

  connect(provider: Provider): TaurusContractCallSigner {
    return new TaurusContractCallSigner(provider, this.client, this.config, this.addressId, this.address);
  }

  protected async tokenOperationRequest(to: string, parsed: TransactionDescription, tx: TransactionRequest): Promise<TaurusRequest> {
    const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
    if (!toWhitelistedAddressId) {
      throw new Error(`Taurus signer: contract ${to} is not in the PROTECT whitelisted-addresses registry — contract calls require the contract whitelisted as an address`);
    }
    return this.client.createContractCallRequest({
      fromAddressId: this.addressId,
      toWhitelistedAddressId,
      method: toContractCall(parsed),
      amount: tx.value !== undefined && tx.value !== null ? tx.value.toString() : undefined,
      gasLimit: tx.gasLimit?.toString(),
      comment: 'finp2p adapter contract call',
    });
  }
}

/** 'transfer-only' mode: plain ERC20 transfers as PROTECT-native currency
 *  transfers; everything else a token standard might do is unsupported. */
export class TaurusTransferOnlySigner extends TaurusSigner {

  connect(provider: Provider): TaurusTransferOnlySigner {
    return new TaurusTransferOnlySigner(provider, this.client, this.config, this.addressId, this.address);
  }

  protected async tokenOperationRequest(to: string, parsed: TransactionDescription): Promise<TaurusRequest> {
    if (parsed.signature !== 'transfer(address,uint256)') {
      throw new Error(`Taurus signer: ${parsed.name} is not supported in transfer-only mode — token standards require TAURUS_OPERATION_MODE=contract-call`);
    }
    const currency = await this.client.findCurrencyByContract(to);
    if (!currency) {
      throw new Error(`Taurus signer: token ${to} is not a registered PROTECT currency — whitelist and approve the contract before transferring`);
    }
    return this.client.createAddressToAddressTransfer({
      fromAddress: this.address,
      toAddress: String(parsed.args[0]),
      amount: (parsed.args[1] as bigint).toString(),
      currency: currency.symbol,
      comment: 'finp2p adapter token transfer',
    });
  }
}

function toArgValue(value: unknown): ContractArgValue {
  if (Array.isArray(value)) return { composite: value.map(toArgValue) };
  if (typeof value === 'bigint' || typeof value === 'boolean' || typeof value === 'number') {
    return { primitive: value.toString() };
  }
  return { primitive: String(value) };
}

function toContractCall(parsed: TransactionDescription): ContractCall {
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
  const parsed = parseTokenCalldata(data);
  if (!parsed) {
    throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not part of the frozen token-contract models — PROTECT accepts structured calls only`);
  }
  return toContractCall(parsed);
}
