import { CommonService, ExecDetailsStore } from "./common";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "../finp2p/policy";
import { CollateralAssetDetails, CollateralService } from "./collateral";

export class PaymentsService extends CommonService {

  constructor(finP2PContract: FinP2PContract,
              policyGetter: PolicyGetter | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              collateralService: CollateralService | undefined
  ) {
    super(finP2PContract, policyGetter, execDetailsStore, collateralService);
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, destination, nonce, signature } = request;
    if (!details || !this.collateralService) {
      return {
        isCompleted: true, cid: uuid(),
        response: {
          account: request.destination, description: "", details: {}
        }
      } as Paths.DepositInstruction.Responses.$200;
    }
    const cid = await this.collateralService.startCollateralAgreement(details as CollateralAssetDetails);

    return {
      isCompleted: false, cid,
      operationMetadata: {
        operationResponseStrategy: {
          type: "callback",
          callback: {
            type: "endpoint"
          }
        }
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
