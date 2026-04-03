import { Provider, TransactionRequest, TypedDataDomain, TypedDataField } from 'ethers';
import { DfnsWallet } from '@dfns/lib-ethersjs6';
import { CustodySigner } from './custody-signer';

/**
 * DFNS custody signer.
 *
 * Wraps DfnsWallet and delegates signTransaction/signMessage/signTypedData to
 * it. DfnsWallet.signTransaction() returns a signed tx hex WITHOUT
 * broadcasting — exactly what we need.
 *
 * sendTransaction() is inherited from AbstractSigner: it calls
 * signTransaction() then provider.broadcastTransaction().
 */
export class DfnsCustodySigner extends CustodySigner {
  private readonly dfnsWallet: DfnsWallet;

  constructor(address: string, dfnsWallet: DfnsWallet, provider: Provider) {
    super(address, provider);
    this.dfnsWallet = dfnsWallet;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    return this.dfnsWallet.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.dfnsWallet.signMessage(message);
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return this.dfnsWallet.signTypedData(domain, types, value);
  }

  connect(provider: Provider): DfnsCustodySigner {
    return new DfnsCustodySigner(this._address, this.dfnsWallet, provider);
  }
}
