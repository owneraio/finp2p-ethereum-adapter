import { CommonService } from "./common";
import { v4 as uuid } from "uuid";
import { CollateralAssetDetails } from "./collateral";
import { logger } from "../helpers/logger";

export class PaymentsService extends CommonService {

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, destination, nonce, signature } = request;
    if (!this.collateralService) {
      logger.info(`No collateral service available, skipping deposit instruction`);
    }
    if (!details) {
      logger.info(`No details provided for deposit instruction`);
    }
    if (!details || !this.collateralService) {
      return {
        isCompleted: true, cid: uuid(), response: {
          account: request.destination, description: "IBAN GB33BUKB20201555555555", details: request.details
        }
      } as Paths.DepositInstruction.Responses.$200;
    }

    const cid = uuid();
    this.collateralService.startCollateralAgreement(cid, details as CollateralAssetDetails)
      .catch(e => {
        logger.error(e);
      });


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
