import { AssetType, Phase } from "../../finp2p-contracts/src/contracts/model";
import {
  AccountFactory,
  AssetCollateralAccount,
  CollateralAssetMetadata
} from "../../finp2p-contracts/src/contracts/collateral";
import { logger } from "../helpers/logger";
import { FinAPIClient } from "../finp2p/finapi/finapi.client";
import process from "process";
import { finIdToAddress } from "../../finp2p-contracts/src/contracts/utils";
import { OssClient } from "../finp2p/oss.client";
import { AddressLike, parseUnits, Signer } from "ethers";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import IntentType = FinAPIComponents.Schemas.IntentType;
import OperationBase = Components.Schemas.OperationBase;
import OperationStatusDeposit = Components.Schemas.OperationStatusDeposit;
import ResourceIdResponse = FinAPIComponents.Schemas.ResourceIdResponse;
import ApiAnyError = Components.Schemas.ApiAnyError;


const getEnvOrThrow = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable "${name}" not found`);
  }
  return value;
};

export class CollateralService {

  private finP2PContract: FinP2PContract;
  private ossClient: OssClient;
  private finAPIClient: FinAPIClient;
  private accountFactory: AccountFactory;
  private accountFactoryAddress: string;
  private haircutContextAddress: string;
  private priceServiceAddress: string;
  private signer: Signer;

  constructor(finP2PContract: FinP2PContract, ossClient: OssClient, finAPIClient: FinAPIClient, signer: Signer) {
    this.finP2PContract = finP2PContract;
    this.ossClient = ossClient;
    this.finAPIClient = finAPIClient;
    this.signer = signer;
    this.accountFactoryAddress = getEnvOrThrow("FACTORY_ADDRESS");
    this.haircutContextAddress = getEnvOrThrow("HAIRCUT_CONTEXT");
    this.priceServiceAddress = getEnvOrThrow("PRICE_SERVICE_ADDRESS");
    this.accountFactory = new AccountFactory(signer, this.accountFactoryAddress);
  }

  async getCollateralAsset(assetId: string): Promise<CollateralAssetMetadata | undefined> {
    const { type, config } = await this.ossClient.getAsset(assetId);
    if (type === "collateral") {
      return JSON.parse(config) as CollateralAssetMetadata;
    }
  }

  async startCollateralAgreement(cid: string, details: CollateralAssetDetails) {
    try {
      const { assetList, cashAsset, borrower, lender, liabilityAmount, orgsToShare } = details;
      const { id: borrowerId } = await this.ossClient.getOwnerByFinId(borrower);
      const { tokenAddresses, amounts } = await this.prepareTokens(assetList);
      const { currency, pricedInToken } = await this.prepareCash(cashAsset);
      const collateralAssetId = await this.createCollateralAgreement({
        borrower,
        borrowerId,
        lender,
        tokenAddresses,
        amounts,
        liabilityAmount,
        pricedInToken,
        currency,
        orgsToShare
      });
      await this.finAPIClient.sendCallback(cid, successfulOperation(cid, borrower, collateralAssetId));

    } catch (e) {
      logger.error(`Error creating collateral asset: ${e}`);
      await this.finAPIClient.sendCallback(cid, failedOperation(cid, 1, `Failed to create collateral asset`));
    }
  }

  async processCollateralAgreement(assetId: string, phase: Phase) {
    try {
      const collateralAsset = await this.getCollateralAsset(assetId);
      if (collateralAsset) {
        const { collateralAccount, tokenAddresses, amounts } = collateralAsset;
        const { signer } = this.finP2PContract;
        const collateralContract = new AssetCollateralAccount(signer, collateralAccount);
        if (phase === Phase.Initiate) {
          for (let i = 0; i < tokenAddresses.length; i++) {
            const tokenAddress = tokenAddresses[i];
            const amount = amounts[i];
            logger.info(`Depositing ${amount} of ${tokenAddress} to ${collateralAccount}`);
            await collateralContract.deposit(tokenAddress, amount);
          }

        } else {
          logger.info(`Releasing collateral from ${collateralAccount}`);
          await collateralContract.release();
        }
        // todo: send receipts
      }
    } catch (e) {
      logger.error(`Error processing collateral agreement: ${e}`);
    }
  }

  private async createCollateralAgreement(data: CollateralAgreementData) {
    const {
      borrower,
      lender,
      tokenAddresses,
      amounts,
      liabilityAmount,
      pricedInToken,
      borrowerId,
      currency,
      orgsToShare
    } = data;

    logger.info(`Creating collateral agreement ${JSON.stringify(data)}...`);

    const collateralAccount = await this.createCollateralAccount(
      borrower,
      lender,
      tokenAddresses,
      pricedInToken,
      liabilityAmount
    );

    const collateralAssetId = await this.createFinP2PAsset(
      collateralAccount,
      borrowerId,
      currency,
      {
        collateralAccount,
        tokenAddresses,
        amounts,
        borrower,
        lender
      } as CollateralAssetMetadata
    );
    logger.info(`Collateral asset created: ${collateralAssetId}`);

    await this.shareFinP2PAsset(collateralAssetId, orgsToShare || []);

    await this.mint(borrower, "1", collateralAssetId);

    return collateralAssetId;
  }


  private async createCollateralAccount(
    borrower: string,
    lender: string,
    tokenAddresses: AddressLike[],
    pricedInToken: AddressLike,
    liabilityAmount: number
  ) {
    logger.info(`Creating collateral account, borrower: ${borrower}, lender: ${lender}`);

    const borrowerAddress = finIdToAddress(borrower);
    const lenderAddress = finIdToAddress(lender);
    const controller = await this.signer.getAddress();
    const collateralAccount = await this.accountFactory.createAccount(
      borrowerAddress, lenderAddress, controller
    );
    logger.info(`Collateral asset address: ${collateralAccount}`);

    logger.info(`Setting configuration bundle for ${collateralAccount}...`);
    const collateralContract = new AssetCollateralAccount(this.signer, collateralAccount);
    await collateralContract.setConfigurationBundle(
      this.haircutContextAddress, this.priceServiceAddress, pricedInToken, liabilityAmount, []
    );

    logger.info(`Whitelisting assets for ${collateralAccount}...`);
    await collateralContract.setAllowableCollateral(tokenAddresses);

    return collateralAccount;
  }

  private async createFinP2PAsset(
    collateralAccount: AddressLike,
    borrowerId: string,
    currency: string,
    metadata: CollateralAssetMetadata,
    assetName: string = `Collateral asset ${collateralAccount}`,
    assetType: string = "collateral",
    intentTypes: IntentType[] = ["loanIntent"]
  ) {
    logger.info(`Creation FinP2P Collateral asset`)
    const rsp = await this.finAPIClient.createAsset(
      assetName, assetType, borrowerId, currency, intentTypes, metadata
    );
    if ((rsp as ResourceIdResponse).id) {
      const { id } = rsp as ResourceIdResponse;
      return id;

    } else if ((rsp as ApiAnyError).type === "error") {
      const { errors: [message] } = rsp as ApiAnyError;
      throw new Error(`Error creating asset: ${message}`);

    } else if ((rsp as OperationBase).cid) {
      const { cid } = rsp as OperationBase;
      const { id } = await this.waitForProfileCompletion(cid);
      return id;

    } else {
      throw new Error("Unexpected response from FinAPI");
    }
  }

  private async shareFinP2PAsset(assetId: string, withOrgs: string[]) {
    if (withOrgs.length > 0) {
      logger.info(`Sharing profile with organizations: ${withOrgs}`);
      await this.finAPIClient.shareProfile(assetId, withOrgs);
    }
  }

  private async mint(issuerFinId: string, amount: string,
                            assetId: string, assetType: AssetType = AssetType.FinP2P
  ) {
    logger.info(`Issuing ${amount} asset ${assetId}...`);
    const txHash = await this.finP2PContract.issue(issuerFinId,
      { assetId, assetType, amount });
    await this.finP2PContract.waitForCompletion(txHash);
    const status = await this.finP2PContract.getOperationStatus(txHash);
    switch (status.status) {
      case "completed":
        const { receipt } = status;
        logger.info(`Issue receipt to be imported: ${JSON.stringify(receipt)}`);
        // todo: send receipt
        break
      case "failed":
        const { error } = status;
        logger.info(`Issue failed with status: ${error}`);
        break;
    }
  }

  private async prepareTokens(assetList: Asset[]): Promise<{ tokenAddresses: string[], amounts: number[] }> {
    let tokenAddresses: string[] = [];
    let amounts: number[] = [];
    for (const a of assetList) {
      try {
        const { ledgerAssetInfo: { tokenId: tokenAddress } } = await this.ossClient.getAsset(a.assetId);
        tokenAddresses.push(tokenAddress);
        const decimals = 18; // TODO: get from ERC20
        amounts.push(Number(parseUnits(a.quantity, decimals)));
      } catch (e) {
        logger.error(`Unable to get asset ${a.assetId} from OSS: ${e}`);
      }
    }
    return {
      tokenAddresses, amounts
    };
  }

  private async prepareCash(cashAsset: CashAsset): Promise<{ currency: string, pricedInToken: string }> {
    let currency = "";
    let pricedInToken = "";
    switch (cashAsset.assetType) {
      case "fiat":
        //TODO pick priced in token based on cashAsset.assetId
        pricedInToken = process.env.PRICED_IN_TOKEN || "";
        currency = cashAsset.assetId;
        break;
      case "finp2p":
        ({ ledgerAssetInfo: { tokenId: pricedInToken } } = await this.ossClient.getAsset(cashAsset.assetId));
        currency = "USD"; // TODO
        break;
    }
    return { currency, pricedInToken };
  }

  private async waitForProfileCompletion(cid: string, tries: number = 3000) {
    for (let i = 1; i < tries; i++) {
      const rsp = await this.finAPIClient.getProfileOperationStatus(cid);
      if (!rsp.isCompleted) {
        await new Promise((r) => setTimeout(r, 500));
      } else {
        const { errors, response } = rsp;
        if (errors && errors.length > 0) {
          throw new Error(`Error processing operation ${cid}: ${errors}`);
        } else if (response) {
          return response;
        } else {
          throw new Error(`Operation ${cid} completed with no response`);
        }
      }
    }
    throw new Error(`no result after ${tries} retries`);
  };

}

const successfulOperation = (cid: string, ownerFinId: string, collateralAssetId: string): OperationStatusDeposit => {
  return {
    type: "deposit",
    operation:
      {
        cid,
        isCompleted: true,
        response: {
          account: {
            finId: ownerFinId,
            account: {
              type: "finId",
              finId: ownerFinId
            }
          },
          description: "Collateral asset created",
          details: {
            collateralAssetId
          }
        }
      }
  };
};

const failedOperation = (cid: string, code: number, message: string): OperationStatusDeposit => {
  return {
    type: "deposit",
    operation: {
      cid,
      isCompleted: true,
      error: { code, message }
    }
  };
};

export type Asset = {
  assetId: string,
  quantity: string
};

export type CashAsset = {
  assetId: string,
  assetType: "fiat" | "finp2p",
};

export type CollateralAssetDetails = {
  assetList: Asset[],
  cashAsset: CashAsset
  borrower: string,
  lender: string,
  liabilityAmount: number,
  orgsToShare: string[] | undefined
}

type CollateralAgreementData = {
  borrower: string,
  borrowerId: string,
  lender: string,
  tokenAddresses: string[],
  amounts: number[],
  currency: string,
  pricedInToken: string,
  liabilityAmount: number,
  orgsToShare: string[] | undefined
}