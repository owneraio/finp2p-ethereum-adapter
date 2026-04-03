import { AbstractSigner, Provider, TransactionRequest, TransactionResponse } from 'ethers';

/**
 * Transaction submission strategy.
 *
 * - `custody`: Custody API signs AND broadcasts (default for providers that support it).
 *   Fireblocks uses TRANSFER/CONTRACT_CALL, Blockdaemon IV uses /transfers.
 * - `adapter`: Adapter signs via custody API then broadcasts via its own RPC.
 *   Required for private networks where custody has no direct chain access.
 */
export enum SubmitMode {
  Custody = 'custody',
  Adapter = 'adapter',
}

/**
 * Base class for custody-provider signers.
 *
 * Each custody provider (DFNS, Fireblocks, Blockdaemon IV) extends this and
 * implements `signTransaction()` using the provider's raw-signing API.
 *
 * Submission strategy is controlled via `tx.customData.submitMode`:
 * - `SubmitMode.Custody` (default): custody API signs + broadcasts.
 *   Falls back to adapter-submit if the provider doesn't support it.
 * - `SubmitMode.Adapter`: sign via custody, broadcast via adapter's RPC.
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

  /**
   * Whether this signer supports custody-side transaction submission.
   * Subclasses that can sign+broadcast via their custody API override this.
   */
  get supportsCustodySubmit(): boolean {
    return false;
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const mode = tx.customData?.submitMode as SubmitMode | undefined;
    if (mode === SubmitMode.Adapter) {
      return super.sendTransaction(tx);
    }
    // Default: custody-submit when supported, otherwise adapter-submit
    if (this.supportsCustodySubmit) {
      return this.custodySendTransaction(tx);
    }
    return super.sendTransaction(tx);
  }

  /**
   * Submit a transaction via the custody API (sign + broadcast).
   * Override in subclasses that support custody-side submission.
   */
  protected async custodySendTransaction(_tx: TransactionRequest): Promise<TransactionResponse> {
    throw new Error(`${this.constructor.name} does not support custody-side submission`);
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
