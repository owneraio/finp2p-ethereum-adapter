import { AssetType, Phase } from "../../finp2p-contracts/src/contracts/model";
import {
  AccountFactory,
  AssetCollateralAccount,
  CollateralAssetMetadata, CollateralType, getErc20Details
} from "../../finp2p-contracts/src/contracts/collateral";
import { logger } from "../helpers/logger";
import { FinAPIClient } from "../finp2p/finapi/finapi.client";
import process from "process";
import { finIdToAddress } from "../../finp2p-contracts/src/contracts/utils";
import { OssClient } from "../finp2p/oss.client";
import { AddressLike, parseUnits, Wallet } from "ethers";
import { FinP2PContract } from "../../finp2p-contracts/src/contracts/finp2p";
import IntentType = FinAPIComponents.Schemas.IntentType;
import OperationBase = Components.Schemas.OperationBase;
import OperationStatusDeposit = Components.Schemas.OperationStatusDeposit;
import ResourceIdResponse = FinAPIComponents.Schemas.ResourceIdResponse;
import ApiAnyError = Components.Schemas.ApiAnyError;
import { ERC20Contract } from "../../finp2p-contracts/src/contracts/erc20";
import { CustodyService } from "./custody";

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
  private custodyService: CustodyService;
  private accountFactoryAddress: string;
  private haircutContextAddress: string;
  private priceServiceAddress: string;

  constructor(finP2PContract: FinP2PContract, ossClient: OssClient, finAPIClient: FinAPIClient) {
    this.finP2PContract = finP2PContract;
    this.ossClient = ossClient;
    this.finAPIClient = finAPIClient;
    this.custodyService = new CustodyService(getEnvOrThrow("CUSTODY_PRIVATE_KEYS"));
    this.accountFactoryAddress = getEnvOrThrow("FACTORY_ADDRESS");
    this.haircutContextAddress = getEnvOrThrow("HAIRCUT_CONTEXT");
    this.priceServiceAddress = getEnvOrThrow("PRICE_SERVICE_ADDRESS");
    const { provider, signer } = finP2PContract;
    this.accountFactory = new AccountFactory(provider, signer, this.accountFactoryAddress, logger);
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
      const { id: borrowerId, certificates: { nodes } } = await this.ossClient.getOwnerByFinId(borrower);
      const borrowerName = extractOwnerName(nodes) || "Borrower";
      const agreementName = `REPO collateral of ${borrowerName}`;
      const { signer } = this.finP2PContract;
      const controller = await signer.getAddress();
      const { tokenAddresses, amounts } = await this.prepareTokens(assetList);
      const { currency, currencyType, pricedInToken } = await this.prepareCash(cashAsset);
      const collateralAssetId = await this.createCollateralAgreement({
        borrower,
        borrowerId,
        lender,
        tokenAddresses,
        amounts,
        liabilityAmount,
        pricedInToken,
        currency,
        currencyType,
        orgsToShare,
        controller,
        agreementName
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
        const { provider } = this.finP2PContract;

        if (phase === Phase.Initiate) {
          const signer = this.custodyService.createWalletByFinId(collateralAsset.borrower).connect(provider);
          logger.info(`Found borrower wallet ${signer.address} by finId ${collateralAsset.borrower}`);
          const collateralContract = new AssetCollateralAccount(provider, signer, collateralAccount, logger);
          for (let i = 0; i < tokenAddresses.length; i++) {
            const tokenAddress = tokenAddresses[i];
            const amount = amounts[i];
            logger.info(`Depositing ${amount} of tokens (${tokenAddress}) to collateral account (${collateralAccount})`);
            const txHash = await collateralContract.deposit(tokenAddress, amount);
            logger.info(`Waiting for deposit transaction ${txHash}`);
            await collateralContract.waitForCompletion(txHash);
          }

        } else {
          const { signer } = this.finP2PContract
          const collateralContract = new AssetCollateralAccount(provider, signer, collateralAccount, logger);
          logger.info(`Releasing collateral from collateral account (${collateralAccount})`);
          const txHash = await collateralContract.release();
          logger.info(`Waiting for release transaction ${txHash}`);
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
      currencyType,
      orgsToShare,
      controller,
      agreementName
    } = data;

    logger.info(`Creating collateral agreement ${JSON.stringify(data)}...`);

    const collateralAccount = await this.createCollateralAccount(
      borrower,
      lender,
      tokenAddresses,
      pricedInToken,
      liabilityAmount,
      controller,
      agreementName
    );

    const collateralAssetId = await this.createFinP2PAsset(
      collateralAccount,
      borrowerId,
      currency,
      currencyType,
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

    logger.info(`Approving collateral for ${borrower}...`);
    await this.erc20ApproveCollateral(tokenAddresses, borrower, collateralAccount, amounts);
    // await this.erc20ApproveCollateral(tokenAddresses, controller, collateralAccount, amounts);

    return collateralAssetId;
  }


  private async createCollateralAccount(
    borrower: string,
    lender: string,
    tokenAddresses: AddressLike[],
    pricedInToken: AddressLike,
    liabilityAmount: number,
    controller: string,
    agreementName: string
  ) {

    const { provider, signer } = this.finP2PContract;
    const borrowerAddress = finIdToAddress(borrower);
    const lenderAddress = finIdToAddress(lender);

    logger.info(`Creating collateral account, name: ${agreementName}, type: REPO, provider: ${borrowerAddress}, receiver: ${lenderAddress}`);

    const collateralAccount = await this.accountFactory.createAccount(
      borrowerAddress, lenderAddress, controller, agreementName
    );
    logger.info(`Collateral asset address: ${collateralAccount}`);

    logger.info(`Setting configuration bundle for ${collateralAccount}...`);
    const collateralContract = new AssetCollateralAccount(provider, signer, collateralAccount, logger);
    let txHash = await collateralContract.setConfigurationBundle(
      this.haircutContextAddress, this.priceServiceAddress, pricedInToken, liabilityAmount, []
    );
    await collateralContract.waitForCompletion(txHash);

    logger.info(`Whitelisting assets for ${collateralAccount}...`);
    txHash = await collateralContract.setAllowableCollateral(tokenAddresses);
    await collateralContract.waitForCompletion(txHash);
    return collateralAccount;
  }

  private async createFinP2PAsset(
    collateralAccount: AddressLike,
    borrowerId: string,
    currency: string,
    currencyType: 'fiat' | 'cryptocurrency',
    metadata: CollateralAssetMetadata,
    assetName: string = `Collateral asset ${collateralAccount}`,
    assetType: string = "collateral",
    intentTypes: IntentType[] = ["loanIntent"]
  ) {
    logger.info(`Creating FinP2P Collateral asset`);
    const rsp = await this.finAPIClient.createAsset(
      assetName, assetType, borrowerId, currency, currencyType, intentTypes, metadata
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
        break;
      case "failed":
        const { error } = status;
        logger.info(`Issue failed with status: ${error}`);
        break;
    }
  }

  private async erc20ApproveCollateral(tokenAddresses: string[], ownerFinId: string, collateralAccount: string, amounts: string[]) {
    const { provider } = this.finP2PContract;
    const signer = this.custodyService.createWalletByFinId(ownerFinId).connect(provider);
    for (let i = 0; i < tokenAddresses.length; i++) {
      const tokenAddress = tokenAddresses[i];
      const amount = amounts[i];
      const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
      const tokenName = await erc20.name();
      const tokenTicker = await erc20.symbol();
      logger.info(`Approve spending for borrower with ${amount} of '${tokenName} (${tokenTicker})', address: ${tokenAddress}...`);
      const res = await erc20.approve(collateralAccount, amount);
      await res.wait();
    }
  }

  private async prepareTokens(assetList: Asset[]): Promise<{ tokenAddresses: string[], amounts: string[] }> {
    let tokenAddresses: string[] = [];
    let amounts: string[] = [];
    for (const a of assetList) {
      try {
        const { ledgerAssetInfo: { tokenId: tokenAddress } } = await this.ossClient.getAsset(a.assetId);
        tokenAddresses.push(tokenAddress);
        const { name, symbol, decimals } = await getErc20Details(this.finP2PContract.signer, tokenAddress);
        logger.info(`Found token for asset ${a.assetId}:\naddress: ${tokenAddress}, name: '${name}', symbol: ${symbol}, decimals: ${decimals}`);
        amounts.push(String(parseUnits(a.quantity, decimals)));
      } catch (e) {
        logger.error(`Unable to get asset ${a.assetId} from OSS: ${e}`);
      }
    }
    return {
      tokenAddresses, amounts
    };
  }

  private async prepareCash(cashAsset: CashAsset): Promise<{ currency: string, currencyType: 'fiat' | 'cryptocurrency', pricedInToken: string }> {
    let currency = "";
    let currencyType: 'fiat' | 'cryptocurrency' = "fiat"
    let pricedInToken = "";
    switch (cashAsset.assetType) {
      case "fiat":
        //TODO pick priced in token based on cashAsset.assetId
        pricedInToken = process.env.PRICED_IN_TOKEN || "";
        currency = cashAsset.assetId;
        break
      case "cryptocurrency":
        pricedInToken = process.env.PRICED_IN_TOKEN || "";
        currency = cashAsset.assetId;
        currencyType = 'cryptocurrency'
        break
      case "finp2p":
        ({ ledgerAssetInfo: { tokenId: pricedInToken } } = await this.ossClient.getAsset(cashAsset.assetId));
        currency = "USD"; // TODO
        break;
    }
    return { currency, currencyType, pricedInToken };
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

const extractOwnerName = (certificates: { type: string, data: string }[]) => {
  const data = certificates.find(n => n.type === "individual_info")?.data;
  if (data) {
    const { type, name } = JSON.parse(data) as { type: string, name: string };
    if (type === "individual") {
      return name;
    }
  }
};

export type Asset = {
  assetId: string,
  quantity: string
};

export type CashAsset = {
  assetId: string,
  assetType: "fiat" | "finp2p" | "cryptocurrency",
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
  amounts: string[],
  currency: string,
  currencyType: 'fiat' | 'cryptocurrency'
  pricedInToken: string,
  liabilityAmount: number,
  orgsToShare: string[] | undefined
  controller: string
  agreementName: string
}