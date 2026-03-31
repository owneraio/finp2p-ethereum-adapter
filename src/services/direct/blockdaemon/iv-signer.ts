import { AbstractSigner, Provider, TransactionRequest, TransactionResponse, formatEther, hexlify } from 'ethers';
import { InstitutionalVaultClient } from './iv-client';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

/**
 * An ethers v6 Signer backed by the Blockdaemon Institutional Vault API.
 *
 * Transactions are submitted via the IV /transfers endpoint (type=transfer for
 * native value sends, type=contract for calldata). The signer polls the
 * transaction status until it settles, then returns a TransactionResponse
 * obtained from the connected RPC provider using the on-chain tx hash.
 */
export class IVSigner extends AbstractSigner {
  private readonly _address: string;
  private readonly _accountID: number;
  private readonly _nativeAssetID: number;
  private readonly _ivClient: InstitutionalVaultClient;

  constructor(
    address: string,
    accountID: number,
    nativeAssetID: number,
    ivClient: InstitutionalVaultClient,
    provider: Provider,
  ) {
    super(provider);
    this._address = address;
    this._accountID = accountID;
    this._nativeAssetID = nativeAssetID;
    this._ivClient = ivClient;
  }

  async getAddress(): Promise<string> {
    return this._address;
  }

  connect(provider: Provider): IVSigner {
    return new IVSigner(this._address, this._accountID, this._nativeAssetID, this._ivClient, provider);
  }

  // ── Transaction submission via IV API ──────────────────────────────────

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const to = tx.to as string;
    if (!to) throw new Error('IVSigner: transaction must have a "to" address');

    const hasCalldata = tx.data && tx.data !== '0x';
    const value = tx.value ? formatEther(tx.value) : '0';

    const transfer = await this._ivClient.createTransfer({
      type: hasCalldata ? 'contract' : 'transfer',
      assetID: this._nativeAssetID,
      fromAddressAmountArray: [{
        address: this._address,
        accountID: this._accountID,
        amount: value,
      }],
      toAddressAmountArray: [{
        address: to,
        ...(hasCalldata ? { calldata: hexlify(tx.data!) } : {}),
        ...(hasCalldata ? {} : { amount: value }),
      }],
      feePriority: 'Medium',
    });

    const txHash = await this.waitForTxHash(transfer.metadata.id);
    return this.provider!.getTransaction(txHash) as Promise<TransactionResponse>;
  }

  /**
   * Poll the IV transaction until it reaches a terminal state and return the
   * on-chain tx hash.
   */
  private async waitForTxHash(ivTransactionID: number): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const tx = await this._ivClient.getTransaction(ivTransactionID);
      const status = tx.status?.status;

      if (status === 'Succeeded' || status === 'Completed') {
        if (!tx.status?.txHash) {
          throw new Error(`IV transaction ${ivTransactionID} succeeded but has no txHash`);
        }
        return tx.status.txHash;
      }

      if (status === 'Failed' || status === 'Cancelled' || status === 'Rejected' || status === 'Error') {
        throw new Error(`IV transaction ${ivTransactionID} terminal status: ${status}`);
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`IV transaction ${ivTransactionID} timed out after ${POLL_TIMEOUT_MS}ms`);
  }

  // ── Unsupported signing operations ─────────────────────────────────────

  async signTransaction(): Promise<string> {
    throw new Error('IVSigner: signTransaction not supported — IV signs internally');
  }

  async signMessage(): Promise<string> {
    throw new Error('IVSigner: signMessage not yet supported by IV API');
  }

  async signTypedData(): Promise<string> {
    throw new Error('IVSigner: signTypedData (EIP-712) not yet supported by IV API');
  }
}
