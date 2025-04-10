import { CommonService, ExecDetailsStore } from "./common";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "../finp2p/policy";
import {
  FinP2PCollateralAssetFactoryContract
} from "../../finp2p-contracts/src/contracts/collateral";
import { FinAPIClient } from "../finp2p/finapi/finapi.client";
import IntentType = FinAPIComponents.Schemas.IntentType;
import { logger } from "../helpers/logger";
import process from "process";
import { OssClient } from "../finp2p/oss.client";

type CollateralAssetDetails = {
  "assetList": [
    {
      "assetId": string,
      "quantity": string
    }
  ],
  "cashAsset": {
    "assetId": string,
    "assetType": "fiat" | "finp2p",
  }
  "borrower": string,
  "lender": string,
  "liabilityAmount": number
}

export class PaymentsService extends CommonService {

  ossClient: OssClient | undefined;
  collateralAssetFactoryContract: FinP2PCollateralAssetFactoryContract;

  constructor(finP2PContract: FinP2PContract,
              collateralAssetFactoryContract: FinP2PCollateralAssetFactoryContract,
              ossClient: OssClient | undefined,
              finApiClient: FinAPIClient | undefined,
              policyGetter: PolicyGetter | undefined,
              execDetailsStore: ExecDetailsStore | undefined
  ) {
    super(finP2PContract, policyGetter, finApiClient, execDetailsStore);
    this.ossClient = ossClient;
    this.collateralAssetFactoryContract = collateralAssetFactoryContract;
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, nonce, signature } = request;
    if (!details || !this.finApiClient || !this.ossClient) {
      return {
        isCompleted: true, cid: uuid(),
        response: {
          account: request.destination, description: "", details: {}
        }
      } as Paths.DepositInstruction.Responses.$200;
    }
    const { assetList, borrower, lender, cashAsset, liabilityAmount } = details as CollateralAssetDetails;

    // STEP 1   ----------------------------------------------------------------


    const { id: borrowerId } = await this.ossClient.getOwnerByFinId(borrower);
    let tokenAddresses: string[] = [];
    for (const a of assetList) {
      const { ledgerAssetInfo: { tokenId: tokenAddress }}  = await this.ossClient.getAsset(a.assetId);
      tokenAddresses.push(tokenAddress);
    }
    const haircutContext = process.env.HAIRCUT_CONTEXT;
    if (!haircutContext) {
      throw new Error("HAIRCUT_CONTEXT not set");
    }
    const priceService = process.env.PRICE_SERVICE;
    if (!priceService) {
      throw new Error("PRICE_SERVICE not set");
    }
    const basketId = uuid();
    const agreementName = "FinP2P Asset Collateral Account";
    const agreementDescription = "A collateral account created as part of FinP2P asset agreement";

    let pricedInToken = "";
    switch (cashAsset.assetType) {
      case "fiat":
        //TODO
        pricedInToken = process.env.PRICED_IN_TOKEN || '';

        break;
      case "finp2p":
        ({ ledgerAssetInfo: { tokenId: pricedInToken }}  = await this.ossClient.getAsset(cashAsset.assetId));
        break;
    }

    await this.collateralAssetFactoryContract.createCollateralAsset(
      basketId, agreementName, agreementDescription, tokenAddresses, assetList.map(a => a.quantity), borrower, lender, {
        haircutContext, priceService, pricedInToken, liabilityAmount,
        assetContextList: []
      }
    );

    // STEP 2   ----------------------------------------------------------------

    const assetName = agreementName;
    const assetType = "collateral";
    const issuerId = borrowerId;
    const tokenId = basketId;
    const intentTypes: IntentType[] = ["loanIntent"];
    const metadata = { tokenType: "COLLATERAL" };
    const res = await this.finApiClient.createAsset(
      assetName, assetType, issuerId, tokenId, intentTypes, metadata);
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
