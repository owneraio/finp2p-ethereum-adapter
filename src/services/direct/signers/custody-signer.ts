import { AbstractSigner, Provider, TransactionRequest } from 'ethers';

/**
 * Base class for custody-provider signers.
 *
 * Each custody provider (DFNS, Fireblocks, Blockdaemon IV) extends this and
 * implements `signTransaction()` using the provider's raw-signing API.
 *
 * `sendTransaction()` is intentionally NOT overridden — the inherited
 * AbstractSigner implementation calls `signTransaction()` then
 * `provider.broadcastTransaction()`, which naturally decouples signing
 * (custody API) from broadcasting (adapter's own JsonRpcProvider).
 *
 * This means:
 * - Public chains: sendTransaction() signs via custody + broadcasts via RPC
 * - Private chains: call signTransaction() directly, broadcast separately
 */
export abstract class CustodySigner extends AbstractSigner {
  protected readonly _address: string;

  constructor(address: string, provider: Provider) {
    super(provider);
    this._address = address;
  }

  async getAddress(): Promise<string> {
    return this._address;
  }

  abstract signTransaction(tx: TransactionRequest): Promise<string>;
  abstract signMessage(message: string | Uint8Array): Promise<string>;
  abstract signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string>;
  abstract connect(provider: Provider): CustodySigner;
}
