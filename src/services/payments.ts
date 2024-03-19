import { CommonService } from './common';
import { v4 as uuid } from 'uuid';
import { AccountService } from './accounts';


export class PaymentsService extends CommonService {

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    return {
      isCompleted: true,
      cid: uuid(),
      response: {
        account: request.destination,
        description: 'IBAN GB33BUKB20201555555555',
        details: request.details,
      },
    } as Paths.DepositInstruction.Responses.$200;
  }

  public async payout(request: Paths.Payout.RequestBody): Promise<Paths.Payout.Responses.$200> {
    return {
      isCompleted: true,
      cid: uuid(),
      response: {
        id: uuid(),
        source: request.source,
        destination: request.destination,
        quantity: request.quantity,
        asset: request.asset,
        timestamp: Date.now(),
        transactionDetails: {
          transactionId: uuid(),
        },
      },
    } as Paths.Payout.Responses.$200;
  }
}
