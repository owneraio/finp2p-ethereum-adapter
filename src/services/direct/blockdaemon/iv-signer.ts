import { Provider, TransactionRequest, Transaction } from 'ethers';
import { CustodySigner } from '../signers/custody-signer';
import { InstitutionalVaultClient } from './iv-client';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

/**
 * Blockdaemon Institutional Vault signer.
 *
 * Implements signTransaction() via the IV /raw-transfers endpoint which signs
 * without broadcasting. The inherited sendTransaction() from AbstractSigner
 * calls signTransaction() then provider.broadcastTransaction() — giving us
 * decoupled sign-then-broadcast via the adapter's own RPC.
 */
export class IVSigner extends CustodySigner {
  private readonly _accountID: number;
  private readonly _network: string;
  private readonly _ivClient: InstitutionalVaultClient;

  constructor(
    address: string,
    accountID: number,
    network: string,
    ivClient: InstitutionalVaultClient,
    provider: Provider,
  ) {
    super(address, provider);
    this._accountID = accountID;
    this._network = network;
    this._ivClient = ivClient;
  }

  connect(provider: Provider): IVSigner {
    return new IVSigner(this._address, this._accountID, this._network, this._ivClient, provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const pop = await this.populateTransaction(tx);
    const txObj = Transaction.from(pop);
    const unsignedHex = txObj.unsignedSerialized;

    const { asyncOperationID } = await this._ivClient.createRawTransfer({
      fromAccountID: this._accountID,
      fromAddress: this._address,
      protocol: 'ethereum',
      network: this._network,
      symbol: 'ETH',
      rawTransaction: unsignedHex,
    });

    return this.waitForSignedTransaction(asyncOperationID);
  }

  /**
   * Poll the IV operation until the signed transaction is available.
   * Note: IV API returns PascalCase fields (Status, Outputs).
   */
  private async waitForSignedTransaction(operationID: string): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const op = await this._ivClient.getOperation(operationID);
      // IV returns PascalCase — normalize
      const status = (op as any).Status ?? op.status;

      if (status === 'fin') {
        const outputs = (op as any).Outputs ?? op.outputs;
        const signedTx = outputs?.transaction?.signedTransaction;
        if (!signedTx) {
          throw new Error(`IV operation ${operationID} finished but signedTransaction is missing`);
        }
        return signedTx;
      }

      if (status === 'err' || status === 'rej' || status === 'can') {
        const errorDetails = (op as any).ErrorDetails ?? op.errorDetails;
        throw new Error(`IV operation ${operationID} terminal status: ${status} ${errorDetails?.errorCode ?? ''}`);
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`IV operation ${operationID} timed out after ${POLL_TIMEOUT_MS}ms`);
  }

  async signMessage(): Promise<string> {
    throw new Error('IVSigner: signMessage not yet supported by IV API');
  }

  async signTypedData(): Promise<string> {
    throw new Error('IVSigner: signTypedData (EIP-712) not yet supported by IV API');
  }
}
