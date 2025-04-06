import { CommonService, ExecDetailsStore } from "./common";
import { v4 as uuid } from "uuid";
import { CollateralAssetContract } from "../../finp2p-contracts/src/contracts/collateral-asset";
import { AccountFactoryContract } from "../../finp2p-contracts/src/contracts/account-factory";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "../finp2p/policy";

export class PaymentsService extends CommonService {

  assetFactory: AccountFactoryContract;
  collateralAssetContract: CollateralAssetContract;

  constructor(finP2PContract: FinP2PContract, policyGetter: PolicyGetter | undefined, execDetailsStore: ExecDetailsStore | undefined, assetFactory: AccountFactoryContract, collateralAssetContract: CollateralAssetContract) {
    super(finP2PContract, policyGetter, execDetailsStore);
    this.assetFactory = assetFactory;
    this.collateralAssetContract = collateralAssetContract;
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, nonce, signature } = request;
    if (details) {

      const assetList = details["assetList"] as string[];
      for (const assetId of assetList) {
        const tokenAddress = await this.policyGetter!.getAssetToken(assetId);


      }
      const agreementName = '';
      const agreementDescription = '';
      const source = '0x'
      const destination = '0x'
      const agreementId = await this.assetFactory.createRepoAgreement(agreementName, agreementDescription, source, destination)

      // TODO: create asset with agreementId passed in tokenId and tokenType=COLLATERAL passed with metadata


    }


    return {
      isCompleted: true, cid: uuid(),
      response: {
        account: request.destination, description: "", details: {}
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
