import process from "process";
import { createProviderAndSigner } from "../../src/contracts/config";
import winston, { format, transports } from "winston";
import {
  AddressLike,
  parseUnits,
  Wallet,
  ZeroAddress
} from "ethers";

import { createAccount } from "../../src/contracts/utils";
import {
  AccountFactory,
  AccountInfo, allowBorrowerWithAssets, AssetCollateralAccount,
  AssetInfo,
  AssetPriceContext,
  deployERC20,
  getERC20Balance,
  getErc20Details, HaircutContext, parseAssets,
  prefundBorrower, sleep
} from "./common";


const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});


const collateralFlow1 = async (
  factoryAddress: AddressLike,
  haircutContextAddress: AddressLike,
  priceServiceAddress: AddressLike,
  pricedInToken: AddressLike,
  assetContextList: AddressLike[] = [],
  assets: AssetInfo[] = [],
  borrower: AccountInfo = createAccount(),
  lender: AccountInfo = createAccount()
) => {
  const { provider, signer } = await createProviderAndSigner("local", logger);
  const network = await provider.getNetwork();
  logger.info(`Network name: ${network.name}`);
  const chainId = network.chainId;
  logger.info(`Network chainId: ${chainId}`);


  const {
    name: cashERC20Name,
    symbol: cashERC20Symbol,
    decimals: cashERC20Decimals
  } = await getErc20Details(signer, pricedInToken);
  logger.info(`Cash ERC20 '${cashERC20Name}' (${cashERC20Symbol}), decimals: ${cashERC20Decimals}`);

  for (let asset of assets) {
    const { name, symbol, decimals, amount, rate, haircut } = asset;
    logger.info(`Creating asset ${name} (${symbol}), decimals: ${decimals}...`);
    asset.tokenAddress = await deployERC20(signer, name, symbol, decimals);
    logger.info(`Asset address: ${asset.tokenAddress}`);
    await prefundBorrower(signer, borrower.address, asset.tokenAddress, amount, logger);

    logger.info(`Borrower balance: ${await getERC20Balance(signer, asset.tokenAddress, borrower.address)}`);

    const assetPriceContext = new AssetPriceContext(signer, priceServiceAddress);
    const haircutContext = new HaircutContext(signer, haircutContextAddress);

    logger.info(`Setting asset rate ${rate}...`);
    await assetPriceContext.setAssetRate(asset.tokenAddress, pricedInToken, rate);

    logger.info(`Setting asset haircut ${haircut}...`);
    await haircutContext.setAssetHaircut(asset.tokenAddress, haircut);
  }

  const collateralAccountFactory = new AccountFactory(signer, factoryAddress);
  logger.info(`Creating collateral asset account...`);
  const controller = await signer.getAddress();
  const collateralAddress = await collateralAccountFactory.createAccount(
    borrower.address, lender.address, controller
  );
  logger.info(`Collateral asset address: ${collateralAddress}`);
  const collateralAccount = new AssetCollateralAccount(signer, collateralAddress);

  const liabilityAmount = parseUnits("1000", 18);
  logger.info(`Setting configuration bundle for ${collateralAddress}...`);
  await collateralAccount.setConfigurationBundle(
    haircutContextAddress, priceServiceAddress, pricedInToken, liabilityAmount, assetContextList
  );

  logger.info(`Whitelisting assets for ${collateralAddress}...`);
  let tokenAddresses = assets.map(a => a.tokenAddress);
  await collateralAccount.setAllowableCollateral(tokenAddresses);


  logger.info(`Whitelisted assets: ${await collateralAccount.getAllowableCollateral()}`);

  const collateralAccountBorrower = new AssetCollateralAccount(new Wallet(borrower.privateKey).connect(provider), collateralAddress);
  for (const asset of assets) {
    const { tokenAddress, amount } = asset;
    await allowBorrowerWithAssets(borrower.privateKey, collateralAddress, tokenAddress, amount, logger);

    logger.info(`Depositing to ${collateralAddress}...`);
    await collateralAccountBorrower.deposit(tokenAddress, amount);

    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
  }

  logger.info(`Waiting for 5 seconds...`);
  await sleep(5000);

  logger.info(`Releasing ${collateralAddress}...`);
  await collateralAccount.release();

  for (const asset of assets) {
    const { tokenAddress } = asset;
    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
  }
};

const factoryAddress = process.env.FACTORY_ADDRESS;
if (!factoryAddress) {
  throw new Error("FACTORY_ADDRESS is not set");
}

const haircutContext = process.env.HAIRCUT_CONTEXT;
if (!haircutContext) {
  throw new Error("HAIRCUT_CONTEXT is not set");
}

const priceService = process.env.PRICE_SERVICE;
if (!priceService) {
  throw new Error("PRICE_SERVICE is not set");
}

const pricedInToken = process.env.PRICED_IN_TOKEN;
if (!pricedInToken) {
  throw new Error("PRICED_IN_TOKEN is not set");
}

let assetContextList: AddressLike[] = [];
const assetContextListStr = process.env.ASSET_CONTEXT_LIST;
if (assetContextListStr) {
  assetContextList = assetContextListStr.split(",").map((address) => address.trim());
}

const assets = parseAssets(process.env.ASSETS);

collateralFlow1(factoryAddress, haircutContext, priceService, pricedInToken, assetContextList, assets)
  .then(() => {
  }).catch(e => {
  logger.error(e);
});