import { CommonService, ExecDetailsStore } from "./common";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "../finp2p/policy";
import { FinP2PCollateralAssetFactoryContract } from "../../finp2p-contracts/src/contracts/collateral";
import { FinAPIClient } from "../finp2p/finapi/finapi.client";
import IntentType = FinAPIComponents.Schemas.IntentType;
import { logger } from "../helpers/logger";

export class PaymentsService extends CommonService {

  collateralAssetFactoryContract: FinP2PCollateralAssetFactoryContract;

  constructor(finP2PContract: FinP2PContract, policyGetter: PolicyGetter | undefined,
              finApiClient: FinAPIClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              collateralAssetFactoryContract: FinP2PCollateralAssetFactoryContract) {
    super(finP2PContract, policyGetter, finApiClient, execDetailsStore);
    this.collateralAssetFactoryContract = collateralAssetFactoryContract;
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, nonce, signature } = request;
    if (!details || !this.finApiClient || !this.policyGetter) {
      return {
        isCompleted: true, cid: uuid(),
        response: {
          account: request.destination, description: "", details: {}
        }
      } as Paths.DepositInstruction.Responses.$200;
    }

    const assetList = details["assetList"] as string[];
    let tokenAddresses: string[] = [];
    for (const assetId of assetList) {
      const tokenAddress = await this.policyGetter.getAssetToken(assetId);
      tokenAddresses.push(tokenAddress);
    }
    const quantities = details["quantities"] as string[];
    const borrower = details["borrower"] as string;
    const lender = details["lender"] as string;
    const { id: borrowerId } = await this.policyGetter.getOwnerByFinId(borrower);
    const agreementName = "FinP2P Asset Collateral Account";
    const agreementDescription = "A collateral account created as part of FinP2P asset agreement";
    const basketId = uuid();

    await this.collateralAssetFactoryContract.createCollateralAsset(
      basketId, agreementName, agreementDescription, tokenAddresses, quantities, borrower, lender
    );

    // TODO: create asset with agreementId passed in tokenId and tokenType=COLLATERAL passed with metadata

    const assetName = agreementName;
    const assetType = "collateral";
    const issuerId = borrowerId;
    const tokenId = basketId;
    const intentTypes: IntentType[] = ["loanIntent"];
    const config = JSON.stringify({});
    const metadata = { tokenType: "COLLATERAL" };
    const res = await this.finApiClient.createAsset(
      assetName, assetType, issuerId, tokenId, intentTypes, config, metadata);
    logger.info(`Collateral asset creation result: ${res}`);
    const { id: collateralAssetId } = res as FinAPIComponents.Schemas.ResourceIdResponse;

    return {
      isCompleted: true, cid: uuid(),
      response: {
        account: request.destination, description: "", details: {
          collateralAssetId
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
