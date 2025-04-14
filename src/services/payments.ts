import { CommonService, ExecDetailsStore } from "./common";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "../finp2p/policy";
import { FinAPIClient } from "../finp2p/finapi/finapi.client";
import { logger } from "../helpers/logger";
import process from "process";
import { OssClient } from "../finp2p/oss.client";
import {
  AccountFactory,
  AssetCollateralAccount,
  CollateralAsset
} from "../../finp2p-contracts/src/contracts/collateral";
import { AssetType } from "../../finp2p-contracts/src/contracts/model";
import IntentType = FinAPIComponents.Schemas.IntentType;
import OperationBase = FinAPIComponents.Schemas.OperationBase;
import ProfileOperation = FinAPIComponents.Schemas.ProfileOperation;
import { parseUnits } from "ethers";
import { finIdToAddress } from "../../finp2p-contracts/src/contracts/utils";

type Asset = {
  assetId: string,
  quantity: string
};

type CashAsset = {
  assetId: string,
  assetType: "fiat" | "finp2p",
};

type CollateralAssetDetails = {
  assetList: Asset[],
  cashAsset: CashAsset
  borrower: string,
  lender: string,
  liabilityAmount: number,
  orgsToShare: string[] | undefined
}

const waitForCompletion = async (finApiClient: FinAPIClient, id: string, tries: number = 3000) => {
  for (let i = 1; i < tries; i++) {
    const rsp = await finApiClient.getOperationStatus(id);
    if (!rsp.isCompleted) {
      await new Promise((r) => setTimeout(r, 500));
    } else {
      return rsp.response;
    }
  }
  throw new Error(`no result after ${tries} retries`);
};


export class PaymentsService extends CommonService {


  constructor(finP2PContract: FinP2PContract,
              policyGetter: PolicyGetter | undefined,
              execDetailsStore: ExecDetailsStore | undefined
  ) {
    super(finP2PContract, policyGetter, execDetailsStore);
  }

  public async deposit(request: Paths.DepositInstruction.RequestBody): Promise<Paths.DepositInstruction.Responses.$200> {
    const { owner, details, destination, nonce, signature } = request;
    if (!details) {
      return {
        isCompleted: true, cid: uuid(),
        response: {
          account: request.destination, description: "", details: {}
        }
      } as Paths.DepositInstruction.Responses.$200;
    }
    const { assetList, borrower, lender, cashAsset, liabilityAmount, orgsToShare } = details as CollateralAssetDetails;

    // STEP 1   ----------------------------------------------------------------

    const osshost = process.env.OSS_HOST;
    if (!osshost) {
      throw new Error("OSS_HOST not set");
    }

    const finP2PAddress = process.env.FINP2P_ADDRESS;
    if (!finP2PAddress) {
      throw new Error("FINP2P_ADDRESS not set");
    }

    const ossClient = new OssClient(osshost, undefined);
    const finApiClient = new FinAPIClient(finP2PAddress);

    const { id: borrowerId } = await ossClient.getOwnerByFinId(borrower);
    let tokenAddresses: string[] = [];
    let amounts: bigint[] = [];
    for (const a of assetList) {
      try {
        const { ledgerAssetInfo: { tokenId: tokenAddress } } = await ossClient.getAsset(a.assetId);
        tokenAddresses.push(tokenAddress);
        const decimals = 18; // TODO: get from ERC20
        amounts.push(parseUnits(a.quantity, decimals));
      } catch (e) {
        logger.error(`Unable to get asset ${a.assetId} from OSS: ${e}`);
      }
    }

    let currency = "";
    let pricedInToken = "";
    switch (cashAsset.assetType) {
      case "fiat":
        //TODO pick priced in token based on cashAsset.assetId
        pricedInToken = process.env.PRICED_IN_TOKEN || "";
        currency = cashAsset.assetId;
        break;
      case "finp2p":
        ({ ledgerAssetInfo: { tokenId: pricedInToken } } = await ossClient.getAsset(cashAsset.assetId));
        currency = "USD"; // TODO
        break;
    }

    const cid = uuid();

    this.createCollateralAccount({
      borrower, borrowerId, lender, amounts, tokenAddresses, liabilityAmount, orgsToShare, pricedInToken,
      currency,
      finApiClient
    })
      .then(collateralAssetId => {
        finApiClient.sendCallback(cid, {
          type: "deposit",
          operation: {
            cid,
            isCompleted: true,
            response: {
              account: destination,
              description: "",
              details: {
                collateralAssetId
              }
            }
          }
        });
      })
      .catch(e => {
        finApiClient.sendCallback(cid, {
          type: "deposit",
          operation: {
            cid,
            isCompleted: true,
            error: { code: 1, message: `Unable to create collateral asset ${e}` }
          }
        });
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

  private async createCollateralAccount(params: {
    borrower: string,
    borrowerId: string,
    lender: string,
    amounts: bigint[],
    tokenAddresses: string[],
    liabilityAmount: number,
    orgsToShare: string[] | undefined
    currency: string,
    pricedInToken: string,
    finApiClient: FinAPIClient
  }) {
    const {
      borrower, borrowerId, lender, liabilityAmount, orgsToShare,
      tokenAddresses, amounts, pricedInToken, currency, finApiClient
    } = params;

    const factoryAddress = process.env.FACTORY_ADDRESS;
    if (!factoryAddress) {
      throw new Error("FACTORY_ADDRESS not set");
    }
    const haircutContext = process.env.HAIRCUT_CONTEXT;
    if (!haircutContext) {
      throw new Error("HAIRCUT_CONTEXT not set");
    }
    const priceService = process.env.PRICE_SERVICE;
    if (!priceService) {
      throw new Error("PRICE_SERVICE not set");
    }
    const signer = this.finP2PContract.signer;
    const controller = await signer.getAddress();
    const borrowerAddress = finIdToAddress(borrower);
    const lenderAddress = finIdToAddress(lender);

    logger.info(`Preparing tokens to collatorilize: ${tokenAddresses.join(",")}, amounts: ${amounts.join(",")},` +
      `borrower: ${borrower}, lender: ${lender}, haircutContext: ${haircutContext}, ` +
      `priceService: ${priceService}, pricedInToken: ${pricedInToken}, controller: ${controller}`);

    const collateralAccountFactory = new AccountFactory(signer, factoryAddress);
    const collateralAccount = await collateralAccountFactory.createAccount(
      borrowerAddress, lenderAddress, controller
    );
    logger.info(`Collateral asset address: ${collateralAccount}`);
    const collateralContract = new AssetCollateralAccount(signer, collateralAccount);
    logger.info(`Setting configuration bundle for ${collateralAccount}...`);
    await collateralContract.setConfigurationBundle(
      haircutContext, priceService, pricedInToken, liabilityAmount, []
    );

    logger.info(`Whitelisting assets for ${collateralAccount}...`);
    await collateralContract.setAllowableCollateral(tokenAddresses);

    // STEP 2   ----------------------------------------------------------------

    const assetName = `Collateral asset ${collateralAccount}`;
    const assetType = "collateral";
    const intentTypes: IntentType[] = ["loanIntent"];
    const metadata = {
      collateralAccount,
      tokenAddresses,
      amounts,
      borrower,
      lender
    } as CollateralAsset;
    const rsp = await finApiClient.createAsset(
      assetName, assetType, borrowerId, currency, intentTypes, metadata);
    const rs = await waitForCompletion(finApiClient, (rsp as OperationBase).cid);
    const { id: collateralAssetId } = (rs as ProfileOperation); // TODO: check errors

    logger.info(`Collateral asset id: ${collateralAssetId}`);

    if (orgsToShare && orgsToShare.length > 0) {
      logger.info(`Sharing profile with organizations: ${orgsToShare}`);
      await finApiClient.shareProfile(collateralAssetId, orgsToShare);
    }

    logger.info(`Issuing 1 collateral asset ${collateralAssetId}...`);
    const issuerFinId = borrower;
    const amount = "1";
    const txHash = await this.finP2PContract.issue(issuerFinId, {
      assetId: collateralAssetId,
      assetType: AssetType.FinP2P,
      amount
    });
    await this.finP2PContract.waitForCompletion(txHash);
    // todo send receipts

    return collateralAssetId;
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
