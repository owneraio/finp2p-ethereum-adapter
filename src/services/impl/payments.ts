import { CommonServiceImpl } from "./common";
import { PaymentService } from "../interfaces";
import {
  Asset,
  DepositOperation,
  Source,
  Destination,
  Signature,
  successfulDepositOperation,
  DepositInstruction, DepositAsset, ReceiptOperation, failedReceiptOperation
} from "../model";


export class PaymentsServiceImpl extends CommonServiceImpl implements PaymentService {

  public async deposit(owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined, details: any | undefined,
                       nonce: string | unknown, signature: Signature): Promise<DepositOperation> {
    return successfulDepositOperation({
      account: destination,
      description: "IBAN GB33BUKB20201555555555",
      details
    } as DepositInstruction)
  }

  public async payout(source: Source, destination: Destination | undefined, asset: Asset, quantity: string,
                      description: string | undefined, nonce: string | undefined,
                      signature: Signature | undefined): Promise<ReceiptOperation> {
    return failedReceiptOperation(1, 'Payouts are not supported');
  }
}
