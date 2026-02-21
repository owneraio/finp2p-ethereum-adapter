import { Asset, DepositAsset, DepositOperation, Destination, PaymentService, ReceiptOperation, Signature, Source } from '@owneraio/finp2p-adapter-models'

export class PaymentsServiceImpl implements PaymentService {
  async getDepositInstruction(idempotencyKey: string, owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined, details: any, nonce: string | undefined, signature: Signature | undefined): Promise<DepositOperation> {
    throw new Error('Method not implemented.');
  }
  async payout(idempotencyKey: string, source: Source, destination: Destination | undefined, asset: Asset, quantity: string, description: string | undefined, nonce: string | undefined, signature: Signature | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }
}
