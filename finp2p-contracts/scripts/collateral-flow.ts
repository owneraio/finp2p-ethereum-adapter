import process from "process";
import { createProviderAndSigner } from "../src/contracts/config";
import winston, { format, transports } from "winston";
import console from "console";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory,
  keccak256, parseUnits,
  Signer,
  toUtf8Bytes,
  Wallet,
  ZeroAddress
} from "ethers";
import { IAccountFactory, IAssetCollateralAccount, IAssetPriceContext, IAssetHaircutContext } from "../typechain-types";
import ACCOUNT_FACTORY
  from "../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import ASSET_COLLATERAL_CONTRACT
  from "../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import { parseCreateAccount } from "../src/contracts/utils";
import ASSET_PRICE_CONTEXT
  from "../artifacts/contracts/token/collateral/price/IAssetPriceContext.sol/IAssetPriceContext.json";
import ASSET_HAIRCUT_CONTEXT
  from "../artifacts/contracts/token/collateral/haircut/IAssetHaircutContext.sol/IAssetHaircutContext.json";
import {
  AssetStruct,
  LiabilityDataStruct
} from "../typechain-types/contracts/token/collateral/IAssetCollateralAccount";
import { AssetStandard, PriceType } from "../src/contracts/collateral";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});


const createAccount = async (
  accountFactoryAddress: string,
  name: string,
  description: string,
  source: string,
  destination: string,
  signer: Signer
) => {
  const factory = new ContractFactory<any[], IAccountFactory>(
    ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, signer
  );
  const accountFactory = factory.attach(accountFactoryAddress) as IAccountFactory;

  const strategyId = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy"));
  const decimals = 18;
  const collateralType = 1; // REPO

  const liabilityFactor = await accountFactory.getLiabilityFactory();
  const controller = await accountFactory.controller();

  const initParams = new AbiCoder().encode(
    ["uint8", "uint8", "uint8", "uint8"],
    [decimals, collateralType, 0, 0]
  );

  const strategyInput = {
    assetContextList: [ZeroAddress],
    addressList: [
      source, destination, liabilityFactor
    ],
    amountList: [],
    effectiveTimeList: [],
    liabilityDataList: []
  };

  const txResp = await accountFactory.createAccount(name, description, strategyId, controller, initParams, strategyInput);
  if (!txResp) {
    throw new Error("Failed to create repo agreement");
  }
  const receipt = await txResp.wait();
  if (!receipt) {
    throw new Error("Failed to get transaction receipt");
  }
  const { address: collateralAddress, id: collateralId } = parseCreateAccount(receipt, accountFactory.interface);

  console.log("Collateral address: ", collateralAddress);
  console.log("Collateral id: ", collateralId);
  return collateralAddress;
};

const setAssetRate = async (contractAddress: string, tokenAddress: AddressLike, pricedIn: AddressLike, rate: BigNumberish, signer: Signer) => {
  const factory = new ContractFactory<any[], IAssetPriceContext>(
    ASSET_PRICE_CONTEXT.abi, ASSET_PRICE_CONTEXT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetPriceContext;

  const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
  await contract.setAssetRate(asset, pricedIn, rate);
};

const getAssetRate = async (contractAddress: string, tokenAddress: AddressLike, pricedIn: AddressLike, signer: Signer) => {
  const factory = new ContractFactory<any[], IAssetPriceContext>(
    ASSET_PRICE_CONTEXT.abi, ASSET_PRICE_CONTEXT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetPriceContext;

  const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
  return await contract.getAssetRate(asset, pricedIn);
};

const setAssetHaircut = async (contractAddress: string, tokenAddress: AddressLike, haircut: BigNumberish, signer: Signer) => {
  const factory = new ContractFactory<any[], IAssetHaircutContext>(
    ASSET_HAIRCUT_CONTEXT.abi, ASSET_HAIRCUT_CONTEXT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetHaircutContext;
  const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
  await contract.setAssetHaircut(asset, haircut);
};


const setAllowableCollateral = async (contractAddress: string, assetList: AddressLike[], signer: Signer) => {
  const factory = new ContractFactory<any[], IAssetCollateralAccount>(
    ASSET_COLLATERAL_CONTRACT.abi, ASSET_COLLATERAL_CONTRACT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetCollateralAccount;
  const rsp = await contract.setAllowableCollateral(assetList);
  await rsp.wait();
};

const setConfigurationBundle = async (
  contractAddress: string,
  haircutContext: AddressLike,
  priceService: AddressLike,
  pricedInToken: AddressLike,
  liabilityAmount: number,
  signer: Signer
) => {
  const factory = new ContractFactory<any[], IAssetCollateralAccount>(
    ASSET_COLLATERAL_CONTRACT.abi, ASSET_COLLATERAL_CONTRACT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetCollateralAccount;
  const targetRatio = parseUnits("12", 17);
  const defaultRatio = parseUnits("12", 17);
  const targetRatioLimit = 2;
  const defaultRatioLimit = 2;
  const priceType = PriceType.DEFAULT;
  const liabilityData: LiabilityDataStruct = {
    liabilityAddress: ZeroAddress,
    amount: liabilityAmount,
    pricedInToken,
    effectiveTime: 1000 * 60 * 60 * 24
  };
  const assetContextList: AddressLike[] = [];
  const rsp = await contract.setConfigurationBundle(
    targetRatio, defaultRatio, targetRatioLimit, defaultRatioLimit, priceType,
    haircutContext, priceService, pricedInToken, liabilityData, assetContextList
  );
  await rsp.wait();
};


const deposit = async (contractAddress: string, asset: AssetStruct, amount: BigNumberish, signer: Signer) => {
  const factory = new ContractFactory<any[], IAssetCollateralAccount>(
    ASSET_COLLATERAL_CONTRACT.abi, ASSET_COLLATERAL_CONTRACT.bytecode, signer
  );
  const contract = factory.attach(contractAddress) as IAssetCollateralAccount;
  const rsp = await contract.deposit(asset, amount);
  await rsp.wait();
};

const collateralFlow = async (
  factoryAddress: string,
  haircutContext: string,
  priceService: string,
  pricedInToken: string,
  tokenAddresses: string[],
  amounts: number[],
  source: string,
  destination: string
) => {
  const { provider, signer } = await createProviderAndSigner("local", logger);
  const network = await provider.getNetwork();
  logger.info(`Network name: ${network.name}`);
  const chainId = network.chainId;
  logger.info(`Network chainId: ${chainId}`);

  const rate = parseUnits("1", 18); // = 1 ether
  for (const tokenAddress of tokenAddresses) {
    await setAssetRate(priceService, tokenAddress, pricedInToken, rate, signer);
  }

  const haircut = 10_000; // Meaning 1% of haircut as we have Haircut Decimals = 4
  for (const tokenAddress of tokenAddresses) {
    await setAssetHaircut(haircutContext, tokenAddress, haircut, signer);
  }

  // -------

  const name = "Asset Collateral Account";
  const description = "Description of Asset Collateral Account";

  const collateralAddress = await createAccount(factoryAddress, name, description, source, destination, signer);

  await setAllowableCollateral(collateralAddress, tokenAddresses, signer);

  const liabilityAmount = 100;
  await setConfigurationBundle(collateralAddress, haircutContext, priceService, pricedInToken, liabilityAmount, signer);
  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    const amount = amounts[i];
    await deposit(collateralAddress, { standard: 1, addr: tokenAddress, tokenId: 0 }, amount, signer);
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

const tokenAddressesStr = process.env.TOKEN_ADDRESSES;
if (!tokenAddressesStr) {
  throw new Error("TOKEN_ADDRESSES is not set");
}
const tokenAddresses = tokenAddressesStr.split(",");

const amountsStr = process.env.AMOUNTS;
if (!amountsStr) {
  throw new Error("AMOUNTS is not set");
}
const amounts = amountsStr.split(",").map(Number);

const source = process.env.SOURCE;
if (!source) {
  throw new Error("SOURCE is not set");
}

const destination = process.env.DESTINATION;
if (!destination) {
  throw new Error("DESTINATION is not set");
}

collateralFlow(factoryAddress, haircutContext, priceService, pricedInToken, tokenAddresses, amounts, source, destination)
  .then(() => {
  }).catch(e => {
  console.error(e);
});