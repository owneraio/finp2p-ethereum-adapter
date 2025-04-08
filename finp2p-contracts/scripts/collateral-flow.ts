import process from "process";
import { createProviderAndSigner } from "../src/contracts/config";
import winston, { format, transports } from "winston";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory,
  keccak256, parseUnits,
  Signer,
  toUtf8Bytes,
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


class AccountFactory {
  contract: IAccountFactory;

  constructor(signer: Signer, contractAddress: string, logger: winston.Logger) {
    this.contract = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, signer
    ).attach(contractAddress) as IAccountFactory;
  }

  async createAccount(
    name: string,
    description: string,
    source: string,
    destination: string
  ) {
    const strategyId = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy"));
    const decimals = 18;
    const collateralType = 1; // REPO

    const liabilityFactor = await this.contract.getLiabilityFactory();
    const controller = await this.contract.controller();

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

    const txResp = await this.contract.createAccount(name, description, strategyId, controller, initParams, strategyInput);
    if (!txResp) {
      throw new Error("Failed to create repo agreement");
    }
    const receipt = await txResp.wait();
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
    const { address: collateralAddress } = parseCreateAccount(receipt, this.contract.interface);

    return collateralAddress;
  };

}

class AssetPriceContext {
  contract: IAssetPriceContext;

  constructor(signer: Signer, contractAddress: string, logger: winston.Logger) {
    this.contract = new ContractFactory<any[], IAssetPriceContext>(
      ASSET_PRICE_CONTEXT.abi, ASSET_PRICE_CONTEXT.bytecode, signer
    ).attach(contractAddress) as IAssetPriceContext;
  }

  async setAssetRate(
    tokenAddress: AddressLike,
    pricedIn: AddressLike,
    rate: BigNumberish
  ) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    const txResp = await this.contract.setAssetRate(asset, pricedIn, rate);
    if (!txResp) {
      throw new Error("Failed to set asset rate");
    }
    const receipt = await txResp.wait();
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
  }

  async getAssetRate(
    tokenAddress: AddressLike,
    pricedIn: AddressLike
  ) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    return await this.contract.getAssetRate(asset, pricedIn);
  }
}

class HaircutContext {
  contract: IAssetHaircutContext;

  constructor(signer: Signer, contractAddress: string, logger: winston.Logger) {
    this.contract = new ContractFactory<any[], IAssetHaircutContext>(
      ASSET_HAIRCUT_CONTEXT.abi, ASSET_HAIRCUT_CONTEXT.bytecode, signer
    ).attach(contractAddress) as IAssetHaircutContext;
  }

  async setAssetHaircut(
    tokenAddress: AddressLike,
    haircut: BigNumberish
  ) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    const txResp = await this.contract.setAssetHaircut(asset, haircut);
    if (!txResp) {
      throw new Error("Failed to set asset haircut");
    }
    const receipt = await txResp.wait();
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
  }
}


class AssetCollateralAccount {
  contract: IAssetCollateralAccount;

  constructor(signer: Signer, contractAddress: string, logger: winston.Logger) {
    this.contract = new ContractFactory<any[], IAssetCollateralAccount>(
      ASSET_COLLATERAL_CONTRACT.abi, ASSET_COLLATERAL_CONTRACT.bytecode, signer
    ).attach(contractAddress) as IAssetCollateralAccount;
  }


  async setAllowableCollateral(assetList: AddressLike[]) {
    const rsp = await this.contract.setAllowableCollateral(assetList);
    await rsp.wait();
  };

  async setConfigurationBundle(
    haircutContext: AddressLike,
    priceService: AddressLike,
    pricedInToken: AddressLike,
    liabilityAmount: number
  ) {
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
    const rsp = await this.contract.setConfigurationBundle(
      targetRatio, defaultRatio, targetRatioLimit, defaultRatioLimit, priceType,
      haircutContext, priceService, pricedInToken, liabilityData, assetContextList
    );
    await rsp.wait();
  };


  async deposit(tokenAddress: AddressLike, amount: BigNumberish) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    const rsp = await this.contract.deposit(asset, amount);
    await rsp.wait();
  };
}


const collateralFlow = async (
  factoryAddress: string,
  haircutContextAddress: string,
  priceServiceAddress: string,
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

  const accountFactory = new AccountFactory(signer, factoryAddress, logger);
  const assetPriceContext = new AssetPriceContext(signer, priceServiceAddress, logger);
  const haircutContext = new HaircutContext(signer, haircutContextAddress, logger);

  const rate = parseUnits("1", 18); // = 1 ether
  for (const tokenAddress of tokenAddresses) {
    logger.info(`Setting asset rate for ${tokenAddress}...`);
    await assetPriceContext.setAssetRate(tokenAddress, pricedInToken, rate);
  }

  const haircut = 10_000; // Meaning 1% of haircut as we have Haircut Decimals = 4
  for (const tokenAddress of tokenAddresses) {
    logger.info(`Setting asset haircut for ${tokenAddress}...`);
    await haircutContext.setAssetHaircut(tokenAddress, haircut);
  }

  // ------------------------------------------------------------------------

  const name = "Asset Collateral Account";
  const description = "Description of Asset Collateral Account";

  logger.info(`Creating collateral asset ${name}...`);
  const collateralAddress = await accountFactory.createAccount(name, description, source, destination);
  logger.info(`Collateral asset address: ${collateralAddress}`);

  const collateralAccount = new AssetCollateralAccount(signer, collateralAddress, logger);

  logger.info(`Setting allowable collateral for ${collateralAddress}...`);
  await collateralAccount.setAllowableCollateral(tokenAddresses);

  const liabilityAmount = 100;

  logger.info(`Setting configuration bundle for ${collateralAddress}...`);
  await collateralAccount.setConfigurationBundle(haircutContextAddress, priceServiceAddress, pricedInToken, liabilityAmount);
  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    const amount = amounts[i];

    logger.info(`Setting configuration bundle for ${collateralAddress}...`);
    await collateralAccount.deposit(tokenAddress, amount);
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
  logger.error(e);
});