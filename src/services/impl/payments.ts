import { CommonServiceImpl } from "./common";
import { v4 as uuid } from "uuid";
import { PaymentService } from "../interfaces";
import { Asset, Destination, Signature } from "../model";
import { Source } from "graphql";


export class PaymentsServiceImpl extends CommonServiceImpl implements PaymentService {

  public async deposit(owner: Source, destination: Destination, asset: Asset, amount: string, nonce: string | unknown, signature: Signature): Promise<Paths.DepositInstruction.Responses.$200> {
    return {
      isCompleted: true, cid: uuid(), response: {
        account: request.destination, description: "IBAN GB33BUKB20201555555555", details: request.details
      }
    } as Paths.DepositInstruction.Responses.$200;
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
