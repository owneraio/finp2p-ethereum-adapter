import process from "process";
import { createProviderAndSigner, getNetworkRpcUrl } from "../src/contracts/config";
import winston, { format, transports } from "winston";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory,
  JsonRpcProvider,
  keccak256,
  NonceManager,
  parseUnits,
  Provider,
  Signer,
  toUtf8Bytes,
  Wallet,
  ZeroAddress
} from "ethers";
import {
  ERC20WithOperator,
  IAccountFactory,
  IAssetCollateralAccount,
  IAssetHaircutContext,
  IAssetPriceContext, IERC20
} from "../typechain-types";
import ERC20 from "../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import ACCOUNT_FACTORY from "../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import ASSET_COLLATERAL_CONTRACT
  from "../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import { createAccount, parseCreateAccount } from "../src/contracts/utils";
import ASSET_PRICE_CONTEXT
  from "../artifacts/contracts/token/collateral/price/IAssetPriceContext.sol/IAssetPriceContext.json";
import ASSET_HAIRCUT_CONTEXT
  from "../artifacts/contracts/token/collateral/haircut/IAssetHaircutContext.sol/IAssetHaircutContext.json";
import {
  AssetStruct,
  LiabilityDataStruct
} from "../typechain-types/contracts/token/collateral/IAssetCollateralAccount";
import { AssetStandard, CollateralType, PriceType } from "../src/contracts/collateral";
import console from "console";
import { ERC20Contract } from "../src/contracts/erc20";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});


class AccountFactory {
  contract: IAccountFactory;

  constructor(signer: Signer, contractAddress: AddressLike) {
    this.contract = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, signer
    ).attach(contractAddress as string) as IAccountFactory;
  }

  async createAccount(
    name: string,
    description: string,
    source: string,
    destination: string,
    assetContextList: AddressLike[] = [],
    amountList: number[] = []
  ) {
    const strategyId = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy"));
    const decimals = 18;
    const collateralType = CollateralType.REPO;

    const liabilityFactory = await this.contract.getLiabilityFactory();
    const controller = await this.contract.controller();

    const initParams = new AbiCoder().encode(
      ["uint8", "uint8", "uint8", "uint8"],
      [decimals, collateralType, 0, 0]
    );

    const addressList = [
      source, destination, liabilityFactory
    ];
    const strategyInput = {
      assetContextList,
      addressList,
      amountList,
      effectiveTimeList: [],
      liabilityDataList: []
    };

    const txResp = await this.contract.createAccount(
      name, description, strategyId, controller, initParams, strategyInput
    );
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

  constructor(signer: Signer, contractAddress: AddressLike) {
    this.contract = new ContractFactory<any[], IAssetPriceContext>(
      ASSET_PRICE_CONTEXT.abi, ASSET_PRICE_CONTEXT.bytecode, signer
    ).attach(contractAddress as string) as IAssetPriceContext;
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

  constructor(signer: Signer, contractAddress: AddressLike) {
    this.contract = new ContractFactory<any[], IAssetHaircutContext>(
      ASSET_HAIRCUT_CONTEXT.abi, ASSET_HAIRCUT_CONTEXT.bytecode, signer
    ).attach(contractAddress as string) as IAssetHaircutContext;
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

  constructor(signer: Signer, contractAddress: string) {
    this.contract = new ContractFactory<any[], IAssetCollateralAccount>(
      ASSET_COLLATERAL_CONTRACT.abi, ASSET_COLLATERAL_CONTRACT.bytecode, signer
    ).attach(contractAddress) as IAssetCollateralAccount;
  }

  async setConfigurationBundle(
    haircutContext: AddressLike,
    priceService: AddressLike,
    pricedInToken: AddressLike,
    liabilityAmount: BigNumberish,
    assetContextList: AddressLike[] = [],
    targetRatio: BigNumberish = parseUnits("1", 18),
    defaultRatio: BigNumberish = parseUnits("1", 18),
    targetRatioLimit: BigNumberish = 2,
    defaultRatioLimit: BigNumberish = 2,
    priceType: PriceType = PriceType.DEFAULT
  ) {
    const liabilityData: LiabilityDataStruct = {
      liabilityAddress: ZeroAddress,
      amount: liabilityAmount,
      pricedInToken,
      effectiveTime: 0
    };
    try {
      const rsp = await this.contract.setConfigurationBundle(
        targetRatio, defaultRatio, targetRatioLimit, defaultRatioLimit, priceType,
        haircutContext, priceService, pricedInToken, liabilityData, assetContextList
      );
      await rsp.wait();
    } catch (e) {
      console.log(e);
    }
  };

  async setAllowableCollateral(
    tokenAddresses: AddressLike[]
  ) {
    const standard = AssetStandard.FUNGIBLE;
    const tokenId = 0;
    const assetList = tokenAddresses.map(addr =>
      ({ standard, addr, tokenId } as AssetStruct));
    await this.contract.setAllowableCollateral(assetList);
  }


  async deposit(tokenAddress: AddressLike, amount: BigNumberish) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    const rsp = await this.contract.deposit(asset, amount);
    await rsp.wait();
  };
}

const getErc20Details = async (signer: Signer, tokenAddress: AddressLike) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const erc20 = factory.attach(tokenAddress as string) as ERC20WithOperator;
  const name = await erc20.name();
  const symbol = await erc20.symbol();
  const decimals = await erc20.decimals();
  return {
    name, symbol, decimals
  };
};

const deployERC20 = async (signer: Signer, name: string, symbol: string, decimals: number) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const operatorAddress = await signer.getAddress();
  const contract = await factory.deploy(name, symbol, decimals, operatorAddress);
  await contract.waitForDeployment();
  return await contract.getAddress();
};

const prefundBorrower = async (signer: Signer, borrower: AddressLike, tokenAddresses: AddressLike[], amounts: BigNumberish[]) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    const amount = amounts[i];
    const erc20 = factory.attach(tokenAddress as string) as ERC20WithOperator;
    const tokenName = await erc20.name();
    const tokenTicker = await erc20.symbol();
    logger.info(`Prefund borrower ${borrower} with ${amount} of ${tokenName} (${tokenTicker}), address: ${tokenAddress}...`);
    const res = await erc20.mint(borrower, amount);
    await res.wait();
  }
};

const allowBorrowerWithAssets = async (borrowerPrivateKey: string, collateralAccount: AddressLike, tokenAddresses: AddressLike[], amounts: BigNumberish[]) => {
  const provider = new JsonRpcProvider(getNetworkRpcUrl());
  const signer = new NonceManager(new Wallet(borrowerPrivateKey)).connect(provider);
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
};

const collateralFlow = async (
  factoryAddress: AddressLike,
  haircutContextAddress: AddressLike,
  priceServiceAddress: AddressLike,
  pricedInToken: AddressLike,
  assetContextList: AddressLike[] = [],
  tokenAddresses: AddressLike[] = [],
  amounts: BigNumberish[] = []
) => {
  const { provider, signer } = await createProviderAndSigner("local", logger);
  const network = await provider.getNetwork();
  logger.info(`Network name: ${network.name}`);
  const chainId = network.chainId;
  logger.info(`Network chainId: ${chainId}`);

  const { name: cashERC20Name, symbol: cashERC20Symbol, decimals: cashERC20Decimals } = await getErc20Details(signer, pricedInToken);
  logger.info(`Cash ERC20 '${cashERC20Name}' (${cashERC20Symbol}), decimals: ${cashERC20Decimals}`);

  const borrower = createAccount();
  const lender = createAccount();

  if (tokenAddresses.length === 0) {
    const tokenAddress = await deployERC20(signer, "Test Bond Token", "TBT", 18);
    tokenAddresses = [tokenAddress];
    amounts = [10000];
    await prefundBorrower(signer, borrower.address, tokenAddresses, amounts);
  }

  const name = "Asset Collateral Account";
  const description = "Description of Asset Collateral Account";

  // // -------------------------------------------------------------------------
  //
  // const manager = new ContractsManager(provider, signer, logger);
  // const { address: finP2PCollateralAddress, contract: basket } = await manager.deployFinP2PCollateralBasket()
  // const afar = await basket.setAccountFactoryAddress(factoryAddress);
  // await afar.wait()
  //
  // logger.info(`Deployed FinP2P collateral contract: ${finP2PCollateralAddress}`);
  // const collateralContract = new FinP2PCollateralAssetFactoryContract(provider, signer, finP2PCollateralAddress, logger);
  // const basketId = uuid();
  // const quantities: string[] = ["10.00"];
  //
  // const sourceAccount = createAccount();
  // const destinationAccount = createAccount();
  // const sourceFinId = privateKeyToFinId(sourceAccount.privateKey);
  // const destinationFinId = privateKeyToFinId(destinationAccount.privateKey);
  // const res = await collateralContract.createCollateralAsset(
  //   name, description, basketId, tokenAddresses, quantities, sourceFinId, destinationFinId, {
  //     haircutContext: haircutContextAddress,
  //     priceService: priceServiceAddress,
  //     pricedInToken: pricedInToken,
  //     liabilityAmount: 10000000000000,
  //     assetContextList: ['0x00BD803dfbEdBbbB138a7e2248B57Fd43cF4b4Ea']
  //   }
  // );
  // const r = await res.wait();
  // console.log(r)
  // console.log(`Created basket account: ${await collateralContract.getBasketAccount(basketId)}`)
  // console.log(`Created basket state: ${await collateralContract.getBasketState(basketId)}`)
  //
  // // -------------------------------------------------------------------------


  const collateralAccountFactory = new AccountFactory(signer, factoryAddress);
  const assetPriceContext = new AssetPriceContext(signer, priceServiceAddress);
  const haircutContext = new HaircutContext(signer, haircutContextAddress);

  const rate = parseUnits("1", 18); // = 1 ether
  for (const tokenAddress of tokenAddresses) {
    logger.info(`Setting asset rate ${rate} for ${tokenAddress}...`);
    await assetPriceContext.setAssetRate(tokenAddress, pricedInToken, rate);
  }

  const haircut = 10_000; // Meaning 1% of haircut as we have Haircut Decimals = 4
  for (const tokenAddress of tokenAddresses) {
    logger.info(`Setting asset haircut ${haircut} for ${tokenAddress}...`);
    await haircutContext.setAssetHaircut(tokenAddress, haircut);
  }

  // ------------------------------------------------------------------------

  logger.info(`Creating collateral asset account '${name}'...`);
  const collateralAddress = await collateralAccountFactory.createAccount(
    name, description, borrower.address, lender.address);
  logger.info(`Collateral asset address: ${collateralAddress}`);
  const collateralAccount = new AssetCollateralAccount(signer, collateralAddress);

  const liabilityAmount = parseUnits("1000", 18);
  logger.info(`Setting configuration bundle for ${collateralAddress}...`);
  await collateralAccount.setConfigurationBundle(
    haircutContextAddress, priceServiceAddress, pricedInToken, liabilityAmount, assetContextList
  );

  logger.info(`Whitelisting assets for ${collateralAddress}...`);
  await collateralAccount.setAllowableCollateral(tokenAddresses);

  await allowBorrowerWithAssets(borrower.privateKey, collateralAddress, tokenAddresses, amounts);

  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];
    const amount = amounts[i];

    logger.info(`Depositing to ${collateralAddress}...`);
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

let assetContextList: AddressLike[] = [];
const assetContextListStr = process.env.ASSET_CONTEXT_LIST;
if (assetContextListStr) {
  assetContextList = assetContextListStr.split(",").map((address) => address.trim());
}

let tokenAddresses: AddressLike[] = [];
const tokenAddressesStr = process.env.TOKEN_ADDRESSES;
if (tokenAddressesStr) {
  tokenAddresses = tokenAddressesStr.split(",").map((address) => address.trim());
}

let amounts: BigNumberish[] = [];
const amountsStr = process.env.AMOUNTS;
if (amountsStr) {
  amounts = amountsStr.split(",").map((amount) => parseUnits(amount.trim(), 18));
}

collateralFlow(factoryAddress, haircutContext, priceService, pricedInToken, assetContextList, tokenAddresses, amounts)
  .then(() => {
  }).catch(e => {
  logger.error(e);
});