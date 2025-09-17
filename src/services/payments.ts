import { CommonServiceImpl } from "./common";
import {
  PaymentService,
  Asset,
  DepositOperation,
  Source,
  Destination,
  Signature,
  successfulDepositOperation,
  DepositInstruction, DepositAsset, ReceiptOperation, failedReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter";


export class PaymentsServiceImpl extends CommonServiceImpl implements PaymentService {

  public async getDepositInstruction(idempotencyKey: string, owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined,
                       details: any | undefined,
                       nonce: string | undefined, signature: Signature | undefined): Promise<DepositOperation> {
    return successfulDepositOperation({
      account: destination,
      description: "IBAN GB33BUKB20201555555555",
      details
    } as DepositInstruction)
  }

  public async payout(idempotencyKey: string, source: Source, destination: Destination | undefined, asset: Asset, quantity: string,
                      description: string | undefined, nonce: string | undefined,
                      signature: Signature | undefined): Promise<ReceiptOperation> {
    return failedReceiptOperation(1, 'Payouts are not supported');
  }
}
