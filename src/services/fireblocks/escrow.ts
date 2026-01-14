import { Asset, Destination, EscrowService, ExecutionContext, ReceiptOperation, Signature, Source } from '@owneraio/finp2p-adapter-models'

export class EscrowServiceImpl implements EscrowService {
  hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, asset: Asset, quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }
  release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }
  rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }
}
