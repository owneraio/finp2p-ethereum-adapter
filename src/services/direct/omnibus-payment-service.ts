import {
  PaymentService,
  Source,
  Destination,
  DepositAsset,
  DepositOperation,
  ReceiptOperation,
  Asset,
  Signature,
  successfulDepositOperation,
  failedReceiptOperation,
} from '@owneraio/finp2p-adapter-models';
import { Provider, Signer } from 'ethers';

export class OmnibusPaymentService implements PaymentService {

  private readonly provider: Provider;
  private readonly signer: Signer;
  private omnibusAddress: string | undefined;

  constructor(provider: Provider, signer: Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  private async getOmnibusAddress(): Promise<string> {
    if (!this.omnibusAddress) {
      this.omnibusAddress = await this.signer.getAddress();
    }
    return this.omnibusAddress;
  }

  async getDepositInstruction(
    _idempotencyKey: string,
    _owner: Source,
    _destination: Destination,
    _asset: DepositAsset,
    _amount: string | undefined,
    _details: any | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<DepositOperation> {
    const omnibusAddress = await this.getOmnibusAddress();
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);

    return successfulDepositOperation({
      account: {
        finId: '',
        account: {
          type: 'crypto',
          address: omnibusAddress,
        },
      },
      description: `Deposit to omnibus account on chain ${chainId}`,
      paymentOptions: [{
        description: 'Crypto transfer to omnibus wallet',
        currency: 'ETH',
        methodInstruction: {
          type: 'cryptoTransfer',
          network: `eip155:${chainId}`,
          contractAddress: '',
          walletAddress: omnibusAddress,
        },
      }],
      operationId: undefined,
      details: undefined,
    });
  }

  async payout(
    _idempotencyKey: string,
    _source: Source,
    _destination: Destination | undefined,
    _asset: Asset,
    _quantity: string,
    _description: string | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    return failedReceiptOperation(1, 'Payout is not supported in omnibus mode');
  }
}
