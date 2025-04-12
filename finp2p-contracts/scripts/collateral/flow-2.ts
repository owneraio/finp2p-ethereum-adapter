import process from "process";
import { createProviderAndSigner } from "../../src/contracts/config";
import winston, { format, transports } from "winston";
import { parseUnits, Wallet } from "ethers";
import { FinP2PCollateralAssetFactoryContract } from "../../src/contracts/collateral";
import { ContractsManager } from "../../src/contracts/manager";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../src/contracts/finp2p";
import { AssetType, operationParams, Phase, term, termToEIP712 } from "../../src/contracts/model";
import { LegType, loanTerms, newInvestmentMessage, PrimaryType, sign } from "../../src/contracts/eip712";
import {
  AccountInfo,
  allowBorrowerWithAssets,
  AssetToCreate,
  AssetPriceContext,
  deployERC20,
  generateAssetId, getERC20Balance,
  getErc20Details,
  HaircutContext, parseAccountInfo,
  parseAssetsToCreate,
  sleep, ExistingAsset, parseExistingAssets, AssetInfo
} from "./common";
import crypto from "crypto";
import { createAccount } from "../../src/contracts/utils";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

export const generateNonce = (): Buffer => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

const collateralFlow2 = async (
  finP2PContractAddress: string | undefined,
  factoryAddress: string,
  haircutContextAddress: string,
  priceServiceAddress: string,
  pricedInToken: string,
  assetsToCreate: AssetToCreate[] = [],
  existingAssets: ExistingAsset[] = [],
  borrower: AccountInfo | undefined,
  lender: AccountInfo | undefined
) => {
  const { provider, signer } = await createProviderAndSigner("local", logger);
  const network = await provider.getNetwork();
  logger.info(`Network name: ${network.name}`);
  const chainId = network.chainId;
  logger.info(`Network chainId: ${chainId}`);

  const controller = await signer.getAddress();

  const manager = new ContractsManager(provider, signer, logger);
  if (!finP2PContractAddress) {
    logger.info(`Deploying FinP2P contract...`);
    finP2PContractAddress = await manager.deployFinP2PContract(
      controller, undefined, factoryAddress as string
    );
    logger.info(`FinP2P contract address: ${finP2PContractAddress}`);
  } else {
    logger.info(`Using FinP2P provided contract address: ${finP2PContractAddress}`);
  }
  const finP2P = new FinP2PContract(provider, signer, finP2PContractAddress, logger);
  const finP2PCollateralAddress = await finP2P.getCollateralAssetManagerAddress();
  const collateralContract = new FinP2PCollateralAssetFactoryContract(provider, signer, finP2PCollateralAddress, logger);
  // const domain = { chainId: network.chainId, verifyingContract: finP2PCollateralAddress };
  const domain = { chainId: 1n, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' };

  let assets: AssetInfo[] = [];
  if (assetsToCreate.length > 0) {
    logger.info(`Got a list of ${assetsToCreate.length} assets to create`);
    const assetPriceContext = new AssetPriceContext(signer, priceServiceAddress);
    const haircutContext = new HaircutContext(signer, haircutContextAddress);
    for (let asset of assetsToCreate) {
      let { name, symbol, decimals, rate, haircut, amount } = asset;
      logger.info(`Creating asset ${name} (${symbol}), decimals: ${decimals}...`);
      const tokenAddress = await deployERC20(signer, name, symbol, decimals, finP2PContractAddress);
      logger.info(`Asset address: ${tokenAddress}`);

      const assetId = generateAssetId();
      logger.info(`Associating asset ${assetId} with token ${tokenAddress}...`);
      await finP2P.waitForCompletion(await finP2P.associateAsset(assetId, tokenAddress));

      logger.info(`Setting asset rate ${rate}...`);
      await assetPriceContext.setAssetRate(tokenAddress, pricedInToken, rate);

      logger.info(`Setting asset haircut ${haircut}...`);
      await haircutContext.setAssetHaircut(tokenAddress, haircut);

      assets.push({ assetId, tokenAddress, amount });
    }
  }

  if (existingAssets.length > 0) {
    logger.info(`Got a list of ${existingAssets.length} existing assets to use`);
    for (let asset of existingAssets) {
      const { assetId, amount } = asset;
      const tokenAddress = await finP2P.getAssetAddress(assetId);
      assets.push({ assetId, tokenAddress, amount });
    }
  }

  if (!borrower) {
    logger.info(`Creating borrower account...`);
    borrower = createAccount();
    logger.info(`Borrower finId: ${borrower.finId}`);

    for (let asset of assets) {
      const { assetId, amount } = asset;
      if (!assetId) continue;
      const txHash = await finP2P.issue(borrower.finId, term(assetId, AssetType.FinP2P, amount));
      await finP2P.waitForCompletion(txHash);
      logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    }
  }

  if (!lender) {
    logger.info(`Creating lender account...`);
    lender = createAccount();
    logger.info(`Lender finId: ${lender.finId}`);
  }

  const {
    name: cashERC20Name,
    symbol: cashERC20Symbol,
    decimals: cashERC20Decimals
  } = await getErc20Details(signer, pricedInToken);
  logger.info(`Cash ERC20 '${cashERC20Name}' (${cashERC20Symbol}), decimals: ${cashERC20Decimals}`);

  // -------------------------------------------------------------------------

  const name = "Asset Collateral Account";
  const description = "Description of Asset Collateral Account";
  const basketId = uuid();
  const tokenAddresses = assets.map(a => a.tokenAddress) as string[];
  const quantities = assets.map(a => a.amount);
  const liabilityAmount = 100000000000;

  logger.info(`Creating collateral asset...`);
  const rsp = await collateralContract.createCollateralAsset(
    name, description, basketId, tokenAddresses,
    quantities, borrower.finId, lender.finId, {
      controller: finP2PCollateralAddress,
      haircutContext: haircutContextAddress as string,
      priceService: priceServiceAddress as string,
      pricedInToken: pricedInToken as string,
      liabilityAmount
    }
  );
  await rsp.wait();
  const collateralAccount = await collateralContract.getBasketAccount(basketId);
  logger.info(`Created account: ${collateralAccount}`);
  const escrowSource = await collateralContract.getEscrowBorrower();
  logger.info(`Escrow source: ${escrowSource}`);
  const escrowDestination = await collateralContract.getEscrowLender();
  logger.info(`Escrow destination: ${escrowDestination}`);

  const collateralAssetId = generateAssetId();
  logger.info(`Associating collateral asset ${collateralAssetId} with basket ${basketId}...`);
  await finP2P.associateCollateralAsset(collateralAssetId, basketId);

  let repoQuantity = "1.00";
  const asset = term(collateralAssetId, AssetType.FinP2P, repoQuantity);
  const settlement = term(cashERC20Symbol, AssetType.FinP2P, "100000000.00");
  const borrowedMoneyAmount = "10000000.00";
  const returnedMoneyAmount = "10000030.00";
  const openTime = "2025-02-01";
  const closeTime = "2025-02-01";
  const loan = loanTerms(openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount);

  const borrowerNonce = `${generateNonce().toString("hex")}`;
  const borrowerMessage = newInvestmentMessage(PrimaryType.Loan, borrowerNonce, lender.finId, borrower.finId,
    termToEIP712(asset), termToEIP712(settlement), loan);
  const borrowerSignature = await sign(domain.chainId, domain.verifyingContract, borrowerMessage.types, borrowerMessage.message, new Wallet(borrower.privateKey));

  const lenderNonce = `${generateNonce().toString("hex")}`;
  const lenderMessage = newInvestmentMessage(PrimaryType.Loan, lenderNonce, lender.finId, borrower.finId,
    termToEIP712(asset), termToEIP712(settlement), loan);
  const lenderSignature = await sign(domain.chainId, domain.verifyingContract, lenderMessage.types, lenderMessage.message, new Wallet(lender.privateKey));

  logger.info(`Initializing repo ----------------------------`);

  for (const asset of assets) {
    const { assetId, tokenAddress, amount } = asset;
    if (!assetId) continue;
    await allowBorrowerWithAssets(borrower.privateKey, collateralAccount, tokenAddress, amount, logger);

    logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    logger.info(`Lender balance: ${await finP2P.balance(assetId, lender.finId)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  for (const asset of assets) {
    const { tokenAddress, amount } = asset;
    await allowBorrowerWithAssets(borrower.privateKey, collateralAccount, tokenAddress, amount, logger);
  }

  logger.info(`Opening repo DVP ----------------------------`);

  let txHash: string;
  const dvp1 = uuid();
  logger.info(`Hold 1 ${dvp1}`);
  txHash = await finP2P.hold(borrowerNonce, borrower.finId, lender.finId, asset, settlement, loan,
    operationParams(domain, PrimaryType.Loan, LegType.Asset, Phase.Initiate, dvp1),
    borrowerSignature.slice(2));
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { assetId, tokenAddress } = asset;
    if (!assetId) continue;
    logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    logger.info(`Lender balance: ${await finP2P.balance(assetId, lender.finId)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info("Release 1 ${dvp1}");
  txHash = await finP2P.releaseTo(dvp1, lender.finId, repoQuantity);
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { assetId, tokenAddress } = asset;
    if (!assetId) continue;
    logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    logger.info(`Lender balance: ${await finP2P.balance(assetId, lender.finId)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info(`Waiting for 5 seconds...`);
  await sleep(5000);

  logger.info(`Closing repo DVP ----------------------------`);

  const dvp2 = uuid();
  logger.info(`Hold 2: ${dvp2}`);
  txHash = await finP2P.hold(lenderNonce, borrower.finId, lender.finId, asset, settlement, loan,
    operationParams(domain, PrimaryType.Loan, LegType.Asset, Phase.Close, dvp2),
    lenderSignature.slice(2));
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { assetId, tokenAddress } = asset;
    if (!assetId) continue;
    logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    logger.info(`Lender balance: ${await finP2P.balance(assetId, lender.finId)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info("Release 2 ${dvp2}");
  txHash = await finP2P.releaseTo(dvp2, borrower.finId, repoQuantity);
  await finP2P.waitForCompletion(txHash);


  for (const asset of assets) {
    const { assetId, tokenAddress } = asset;
    if (!assetId) continue;
    logger.info(`Borrower balance: ${await finP2P.balance(assetId, borrower.finId)}`);
    logger.info(`Lender balance: ${await finP2P.balance(assetId, lender.finId)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

};

const finP2PContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;

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

const assetsToCreate = parseAssetsToCreate(process.env.ASSETS_TO_CREATE);
const existingAssets = parseExistingAssets(process.env.EXISTING_ASSETS);
const borrower = parseAccountInfo(process.env.BORROWER);
const lender = parseAccountInfo(process.env.LENDER);

collateralFlow2(
  finP2PContractAddress,
  factoryAddress,
  haircutContext,
  priceService,
  pricedInToken,
  assetsToCreate,
  existingAssets,
  borrower,
  lender
).then(() => {
}).catch(logger.error);