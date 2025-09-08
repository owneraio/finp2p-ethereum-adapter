import { CommonServiceImpl } from "./common";
import { v4 as uuid } from "uuid";
import { PaymentService } from "../interfaces";
import {
  Asset,
  DepositOperation,
  Source,
  Destination,
  Signature,
  successfulDepositOperation,
  DepositInstruction, DepositAsset
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

  public async payout(request: Paths.Payout.RequestBody): Promise<Paths.Payout.Responses.$200> {
    return {
      isCompleted: true, cid: uuid(), response: {
        id: uuid(),
        source: request.source,
        destination: request.destination,
        quantity: request.quantity,
        asset: request.asset,
        timestamp: Date.now(),
        transactionDetails: {
          transactionId: uuid()
        }
      }
    } as Paths.Payout.Responses.$200;
  }
}
