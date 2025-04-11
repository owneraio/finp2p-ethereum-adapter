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
  FinP2PCollateralAssetFactoryContract
} from "../../src/contracts/collateral";
import { ContractsManager } from "../../src/contracts/manager";
import { v4 as uuid } from "uuid";
import { FinP2PContract } from "../../src/contracts/finp2p";
import { AssetType, operationParams, Phase, term, termToEIP712 } from "../../src/contracts/model";
import { LegType, loanTerms, newInvestmentMessage, PrimaryType, sign } from "../../src/contracts/eip712";
import {
  AccountInfo, allowBorrowerWithAssets, AssetCollateralAccount,
  AssetInfo,
  AssetPriceContext,
  deployERC20, generateAssetId,
  getERC20Balance,
  getErc20Details, HaircutContext,
  prefundBorrower, sleep
} from "./common";
import crypto from "crypto";

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
  factoryAddress: AddressLike,
  haircutContextAddress: AddressLike,
  priceServiceAddress: AddressLike,
  pricedInToken: AddressLike,
  assets: AssetInfo[] = [],
  borrower: AccountInfo = createAccount(),
  lender: AccountInfo = createAccount()
) => {
  const { provider, signer } = await createProviderAndSigner("local", logger);
  const network = await provider.getNetwork();
  logger.info(`Network name: ${network.name}`);
  const chainId = network.chainId;
  logger.info(`Network chainId: ${chainId}`);

  const controller = await signer.getAddress();

  const manager = new ContractsManager(provider, signer, logger);
  const finP2PContractAddress = await manager.deployFinP2PContract(
    controller, undefined, factoryAddress as string
  );
  const finP2P = new FinP2PContract(provider, signer, finP2PContractAddress, logger);
  const finP2PCollateralAddress = await finP2P.getCollateralAssetManagerAddress();
  const collateralContract = new FinP2PCollateralAssetFactoryContract(provider, signer, finP2PCollateralAddress, logger);

  // -------------------------------------------------------------------------

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

    const assetId = generateAssetId();
    logger.info(`Associating asset ${assetId} with token ${asset.tokenAddress}...`);
    await finP2P.waitForCompletion(await finP2P.associateAsset(assetId, asset.tokenAddress));
    let q = parseUnits(amount, decimals);
    await prefundBorrower(signer, borrower.address, asset.tokenAddress, q, logger);

    logger.info(`Borrower balance: ${await getERC20Balance(signer, asset.tokenAddress, borrower.address)}`);

    const assetPriceContext = new AssetPriceContext(signer, priceServiceAddress);
    const haircutContext = new HaircutContext(signer, haircutContextAddress);

    logger.info(`Setting asset rate ${rate}...`);
    await assetPriceContext.setAssetRate(asset.tokenAddress, pricedInToken, rate);

    logger.info(`Setting asset haircut ${haircut}...`);
    await haircutContext.setAssetHaircut(asset.tokenAddress, haircut);
  }

  // -------------------------------------------------------------------------

  const name = "Asset Collateral Account";
  const description = "Description of Asset Collateral Account";
  const basketId = uuid();
  const tokenAddresses = assets.map(a => a.tokenAddress) as string[];
  const quantities = assets.map(a => a.amount.toString());
  const liabilityAmount = 100000000000;

  logger.info(`Creating collateral asset account...`);
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
  logger.info(`Created basket account: ${collateralAccount}`);
  logger.info(`Created basket state: ${await collateralContract.getBasketState(basketId)}`);
  logger.info(`Created basket amounts: ${await collateralContract.getBasketAmounts(basketId)}`);
  const escrowSource = await collateralContract.getEscrowBorrower();
  logger.info(`Escrow source: ${escrowSource}`);
  const escrowDestination = await collateralContract.getEscrowLender();
  logger.info(`Escrow destination: ${escrowDestination}`);

  const collateralAssetId = generateAssetId();
  logger.info(`Associating collateral asset ${collateralAssetId} with basket ${basketId}...`);
  await finP2P.associateCollateralAsset(collateralAssetId, basketId);

  const verifyingContract = finP2PContractAddress;
  let repoQuantity = "1.00";
  const asset = term(collateralAssetId, AssetType.FinP2P, repoQuantity);
  const settlementAssetCode = "USDT";
  const settlement = term(settlementAssetCode, AssetType.FinP2P, "100000000.00");
  const borrowedMoneyAmount = "10000000.00";
  const returnedMoneyAmount = "10000030.00";
  const openTime = "2025-02-01";
  const closeTime = "2025-02-01";
  const loan = loanTerms(openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount);

  const borrowerNonce = `${generateNonce().toString("hex")}`;
  const borrowerMessage = newInvestmentMessage(PrimaryType.Loan, borrowerNonce, lender.finId, borrower.finId,
    termToEIP712(asset), termToEIP712(settlement), loan);
  const borrowerSignature = await sign(chainId, verifyingContract, borrowerMessage.types, borrowerMessage.message, new Wallet(borrower.privateKey));

  const lenderNonce = `${generateNonce().toString("hex")}`;
  const lenderMessage = newInvestmentMessage(PrimaryType.Loan, lenderNonce, lender.finId, borrower.finId,
    termToEIP712(asset), termToEIP712(settlement), loan);
  const lenderSignature = await sign(chainId, verifyingContract, lenderMessage.types, lenderMessage.message, new Wallet(lender.privateKey));

  logger.info(`Initializing repo...`);

  for (const asset of assets) {
    const { tokenAddress, amount } = asset;
    await allowBorrowerWithAssets(borrower.privateKey, collateralAccount, tokenAddress, amount, logger);

    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  for (const asset of assets) {
    const { tokenAddress, amount } = asset;
    await allowBorrowerWithAssets(borrower.privateKey, collateralAccount, tokenAddress, amount, logger);
  }

  let txHash: string;
  const dvp1 = uuid();
  logger.info(`Hold 1 ${dvp1}`);
  txHash = await finP2P.hold(borrowerNonce, borrower.finId, lender.finId, asset, settlement, loan,
    operationParams({ chainId, verifyingContract }, PrimaryType.Loan, LegType.Asset, Phase.Initiate, dvp1),
    borrowerSignature.slice(2));
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { tokenAddress } = asset;
    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info("Release 1 ${dvp1}");
  txHash = await finP2P.releaseTo(dvp1, lender.finId, repoQuantity);
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { tokenAddress } = asset;
    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info(`Waiting for 5 seconds...`);
  await sleep(5000);

  logger.info(`Closing repo...`);

  const dvp2 = uuid();
  logger.info(`Hold 2: ${dvp2}`);
  txHash = await finP2P.hold(lenderNonce, borrower.finId, lender.finId, asset, settlement, loan,
    operationParams({ chainId, verifyingContract }, PrimaryType.Loan, LegType.Asset, Phase.Close, dvp2),
    lenderSignature.slice(2));
  await finP2P.waitForCompletion(txHash);

  for (const asset of assets) {
    const { tokenAddress } = asset;
    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
  }

  logger.info("Release 2 ${dvp2}");
  txHash = await finP2P.releaseTo(dvp2, borrower.finId, repoQuantity);
  await finP2P.waitForCompletion(txHash);


  for (const asset of assets) {
    const { tokenAddress } = asset;
    logger.info(`Borrower balance: ${await getERC20Balance(signer, tokenAddress, borrower.address)}`);
    logger.info(`Lender balance: ${await getERC20Balance(signer, tokenAddress, lender.address)}`);
    logger.info(`Escrow source balance: ${await getERC20Balance(signer, tokenAddress, escrowSource)}`);
    logger.info(`Escrow destination balance: ${await getERC20Balance(signer, tokenAddress, escrowDestination)}`);
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

let assets: AssetInfo[] = [];
const assetsStr = process.env.ASSETS;
if (assetsStr) {
  const assetList = assetsStr.split(";");
  for (const assetStr of assetList) {
    const [name, symbol, decimalsStr, amount, rateStr, haircutStr] = assetStr.split(",").map((s) => s.trim());
    const decimals = parseInt(decimalsStr);
    const rate = parseUnits(rateStr, decimals);
    const haircut = parseInt(haircutStr);
    const tokenAddress = ZeroAddress;
    assets.push({
      name,
      symbol,
      decimals,
      amount,
      rate,
      haircut,
      tokenAddress
    });
  }
}

collateralFlow2(factoryAddress, haircutContext, priceService, pricedInToken, assets)
  .then(() => {
  }).catch(e => {
  logger.error(e);
});