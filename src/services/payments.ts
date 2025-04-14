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
import OperationBase = FinAPIComponents.Schemas.OperationBase;
import ProfileOperation = FinAPIComponents.Schemas.ProfileOperation;


type CollateralAssetDetails = {
  assetList: [
    {
      assetId: string,
      quantity: string
    }
  ],
  cashAsset: {
    assetId: string,
    assetType: "fiat" | "finp2p",
  }
  borrower: string,
  lender: string,
  liabilityAmount: number,
  orgsToShare: string[] | undefined
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
    const { assetList, borrower, lender, cashAsset, liabilityAmount, orgsToShare } = details as CollateralAssetDetails;

    // STEP 1   ----------------------------------------------------------------


    const { id: borrowerId } = await this.ossClient.getOwnerByFinId(borrower);
    let tokenAddresses: string[] = [];
    for (const a of assetList) {
      try {
        const { ledgerAssetInfo: { tokenId: tokenAddress } } = await this.ossClient.getAsset(a.assetId);
        tokenAddresses.push(tokenAddress);
      } catch (e) {
        logger.error(`Unable to get asset ${a.assetId} from OSS: ${e}`);
      }
    }

    const basketId =  uuid();
    const agreementName = "FinP2P Asset Collateral Account";
    const agreementDescription = "A collateral account created as part of FinP2P asset agreement";

    let pricedInToken = "";
    switch (cashAsset.assetType) {
      case "fiat":
        //TODO pick priced in token based on cashAsset.assetId
        pricedInToken = process.env.PRICED_IN_TOKEN || "";
        break;
      case "finp2p":
        ({ ledgerAssetInfo: { tokenId: pricedInToken } } = await this.ossClient.getAsset(cashAsset.assetId));
        break;
    }

    const haircutContext = process.env.HAIRCUT_CONTEXT;
    if (!haircutContext) {
      throw new Error("HAIRCUT_CONTEXT not set");
    }
    const priceService = process.env.PRICE_SERVICE;
    if (!priceService) {
      throw new Error("PRICE_SERVICE not set");
    }
    const quantities = assetList.map(a => a.quantity);

    const controller = this.collateralAssetFactoryContract.contractAddress;
    const cid = uuid();

    (async () => {
      if (!this.finApiClient) {
        throw new Error("finApiClient not set");
      }
      logger.info(`Preparing tokens to collatorilize: ${tokenAddresses.join(",")}, quantities: ${quantities.join(",")},` +
        `borrower: ${borrower}, lender: ${lender}, haircutContext: ${haircutContext}, ` +
        `priceService: ${priceService}, pricedInToken: ${pricedInToken}, controller: ${controller}`);

      try {
        logger.info(`Creating collateral asset with basketId: ${basketId}`);
        const rsp = await this.collateralAssetFactoryContract.createCollateralAsset(
          agreementName, agreementDescription, basketId, tokenAddresses, quantities, borrower, lender, {
            controller, haircutContext, priceService, pricedInToken, liabilityAmount
          }
        );
        await rsp.wait();
      } catch (e) {
        logger.error(`Unable to create collateral asset: ${e}`);
        await this.finApiClient.sendCallback(cid, {
          type: 'deposit',
          operation: {
            cid,
            isCompleted: true,
            error: { code: 1, message: "Unable to create collateral asset" }
          }
        });
        return;
      }

      const account = await this.collateralAssetFactoryContract.getBasketAccount(basketId);
      logger.info(`Basket ${basketId} created, account address: ${account}`);

      // STEP 2   ----------------------------------------------------------------

      const assetName = `collateral-${account}`;
      const assetType = "collateral";
      const issuerId = borrowerId;
      const tokenId = basketId;
      const intentTypes: IntentType[] = ["loanIntent"];
      const metadata = { tokenType: "COLLATERAL" };
      try {
        const rsp = await this.finApiClient.createAsset(
          assetName, assetType, issuerId, tokenId, intentTypes, metadata);
        const rs = await this.waitForCompletion((rsp as OperationBase).cid);
        const { id: collateralAssetId } = (rs as ProfileOperation);
        if (!collateralAssetId) {
          await this.finApiClient.sendCallback(cid, {
            type: 'deposit',
            operation: {
              cid,
              isCompleted: true,
              error: { code: 1, message: "Failed to create asset profile" }
            }
          });
          return;
        }
        logger.info(`Collateral asset id: ${collateralAssetId}`);

        const associatedBasketId = await this.finP2PContract.getBasketId(collateralAssetId);
        if (associatedBasketId !== basketId) {
          logger.warn(`Basket id ${basketId} does not match asset profile id ${collateralAssetId}`);
        }

        if (orgsToShare && orgsToShare.length > 0) {
          logger.info(`Sharing profile with organizations: ${orgsToShare}`);
          await this.finApiClient.shareProfile(collateralAssetId, orgsToShare);
        }

        await this.finApiClient.sendCallback(cid, {
          type: 'deposit',
          operation: {
            cid,
            isCompleted: true,
            response: {
              account: request.destination, description: "", details: {
                collateralAssetId
              }
            }
          }
        });
      } catch (e) {
        logger.warn(e);
        await this.finApiClient.sendCallback(cid, {
          type: 'deposit',
          operation: {
            cid,
            isCompleted: true,
            error: { code: 1, message: `Unable to create collateral asset ${e}` }
          }
        });
        return;
      }
    })().then(r => {});

    return {
      isCompleted: false, cid,
      operationMetadata: {
        operationResponseStrategy: { type: "callback" }
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

  private async waitForCompletion(id: string, tries: number = 3000) {
    if (!this.finApiClient) {
      throw new Error("finApiClient not set");
    }
    for (let i = 1; i < tries; i++) {
      const rsp = await this.finApiClient.getOperationStatus(id);
      if (!rsp.isCompleted) {
        await new Promise((r) => setTimeout(r, 500));
      } else {
        return rsp.response;
      }
    }
    throw new Error(`no result after ${tries} retries`);
  }
}
