import { AbstractSigner, Provider, Signer, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField } from 'ethers';

/**
 * A signer that delegates signing to a remote custody signer (Fireblocks/DFNS)
 * but submits the signed transaction via a local RPC provider.
 *
 * This is useful for private networks where the custody provider doesn't have
 * direct access to the network RPC.
 */
export class LocalSubmitSigner extends AbstractSigner {

  private readonly custodySigner: Signer;

  constructor(custodySigner: Signer, localProvider: Provider) {
    super(localProvider);
    this.custodySigner = custodySigner;
  }

  async getAddress(): Promise<string> {
    return this.custodySigner.getAddress();
  }

  connect(provider: Provider): Signer {
    return new LocalSubmitSigner(this.custodySigner, provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    return this.custodySigner.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.custodySigner.signMessage(message);
  }

  async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
    return this.custodySigner.signTypedData(domain, types, value);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const populated = await this.populateTransaction(tx);
    const signed = await this.signTransaction(populated);
    return this.provider!.broadcastTransaction(signed);
  }
}
