import {
  ERC20WithOperator,
  IAccountFactory,
  IAssetCollateralAccount,
  IAssetHaircutContext,
  IAssetPriceContext
} from "../../typechain-types";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory, JsonRpcProvider,
  keccak256, NonceManager,
  parseUnits,
  Signer,
  toUtf8Bytes, Wallet, ZeroAddress
} from "ethers";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import { AssetStandard, CollateralType, PriceType } from "../../src/contracts/collateral";
import { parseCreateAccount } from "../../src/contracts/utils";
import ASSET_PRICE_CONTEXT
  from "../../artifacts/contracts/token/collateral/price/IAssetPriceContext.sol/IAssetPriceContext.json";
import { AssetStruct } from "../../typechain-types/contracts/token/collateral/IAssetCollateralAccount";
import ASSET_HAIRCUT_CONTEXT
  from "../../artifacts/contracts/token/collateral/haircut/IAssetHaircutContext.sol/IAssetHaircutContext.json";
import ASSET_COLLATERAL_CONTRACT
  from "../../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { getNetworkRpcUrl } from "../../src/contracts/config";
import { ERC20Contract } from "../../src/contracts/erc20";
import { Logger } from "winston";
import { v4 as uuid } from "uuid";
import process from "process";


export class AccountFactory {
  contract: IAccountFactory;

  constructor(signer: Signer, contractAddress: AddressLike) {
    this.contract = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, signer
    ).attach(contractAddress as string) as IAccountFactory;
  }

  async createAccount(
    borrower: AddressLike,
    lender: AddressLike,
    controller: AddressLike,
    name: string = "Asset Collateral Account",
    description: string = "Description of Asset Collateral Account",
    assetContextList: AddressLike[] = [],
    amountList: number[] = [],
    strategyId: string = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy")),
    decimals: number = 18,
    collateralType: CollateralType = CollateralType.REPO
  ) {
    const liabilityFactory = await this.contract.getLiabilityFactory();

    const initParams = new AbiCoder().encode(
      ["uint8", "uint8", "uint8", "uint8"],
      [decimals, collateralType, 0, 0]
    );

    const addressList = [
      borrower, lender, liabilityFactory
    ];

    const strategyInput = {
      assetContextList,
      addressList,
      amountList,
      effectiveTimeList: [],
      liabilityDataList: []
    };

    const rsp = await this.contract.createAccount(
      name, description, strategyId, controller, initParams, strategyInput
    );
    const receipt = await rsp.wait();
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
    const { address: collateralAddress } = parseCreateAccount(receipt, this.contract.interface);

    return collateralAddress;
  };

}

export class AssetPriceContext {
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

export class HaircutContext {
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
    const rsp = await this.contract.setAssetHaircut(asset, haircut);
    await rsp.wait();
  }
}


export class AssetCollateralAccount {
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
    targetRatio: BigNumberish = parseUnits("12", 17),
    defaultRatio: BigNumberish = parseUnits("12", 17),
    targetRatioLimit: BigNumberish = 2,
    defaultRatioLimit: BigNumberish = 2,
    priceType: PriceType = PriceType.DEFAULT
  ) {
    const rsp = await this.contract.setConfigurationBundle(
      targetRatio, defaultRatio, targetRatioLimit, defaultRatioLimit, priceType,
      haircutContext, priceService, pricedInToken,
      {
        liabilityAddress: ZeroAddress,
        amount: liabilityAmount,
        pricedInToken,
        effectiveTime: 0
      },
      assetContextList
    );
    await rsp.wait();
  };

  async getAllowableCollateral() {
    return await this.contract.getAllowableCollateral();
  }

  async setAllowableCollateral(
    tokenAddresses: AddressLike[]
  ) {
    const standard = AssetStandard.FUNGIBLE;
    const tokenId = 0;
    const assetList = tokenAddresses.map(addr =>
      ({ standard, addr, tokenId } as AssetStruct));
    const rsp = await this.contract.setAllowableCollateral(assetList);
    await rsp.wait();
  }


  async deposit(tokenAddress: AddressLike, amount: BigNumberish) {
    const asset: AssetStruct = { standard: AssetStandard.FUNGIBLE, addr: tokenAddress, tokenId: 0 };
    const rsp = await this.contract.deposit(asset, amount);
    await rsp.wait();
  };

  async release() {
    const rsp = await this.contract.release();
    await rsp.wait();
  };
}

export const getErc20Details = async (signer: Signer, tokenAddress: AddressLike) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const erc20 = factory.attach(tokenAddress as string) as ERC20WithOperator;
  const name = await erc20.name();
  const symbol = await erc20.symbol();
  const decimals = await erc20.decimals();
  return {
    name, symbol, decimals
  };
};

export const deployERC20 = async (signer: Signer, name: string, symbol: string, decimals: number) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const operatorAddress = await signer.getAddress();
  const contract = await factory.deploy(name, symbol, decimals, operatorAddress);
  await contract.waitForDeployment();
  return await contract.getAddress();
};

export const prefundBorrower = async (
  signer: Signer,
  borrower: AddressLike,
  tokenAddress: AddressLike,
  amount: BigNumberish,
  logger: Logger
) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const erc20 = factory.attach(tokenAddress as string) as ERC20WithOperator;
  const tokenName = await erc20.name();
  const tokenTicker = await erc20.symbol();
  logger.info(`Prefund borrower ${borrower} with ${amount} of ${tokenName} (${tokenTicker}), address: ${tokenAddress}...`);
  const res = await erc20.mint(borrower, amount);
  await res.wait();
};

export const getERC20Balance = async (signer: Signer, tokenAddress: AddressLike, borrower: AddressLike) => {
  const factory = new ContractFactory<any[], ERC20WithOperator>(ERC20.abi, ERC20.bytecode, signer);
  const erc20 = factory.attach(tokenAddress as string) as ERC20WithOperator;
  try {
    return await erc20.balanceOf(borrower);
  } catch (e) {
    // console.error(e)
    return 0n;
  }
};

export const allowBorrowerWithAssets = async (
  borrowerPrivateKey: string,
  collateralAccount: AddressLike,
  tokenAddress: AddressLike,
  amount: BigNumberish,
  logger: Logger
) => {
  const provider = new JsonRpcProvider(getNetworkRpcUrl());
  const signer = new NonceManager(new Wallet(borrowerPrivateKey)).connect(provider);
  const erc20 = new ERC20Contract(provider, signer, tokenAddress, logger);
  const tokenName = await erc20.name();
  const tokenTicker = await erc20.symbol();
  logger.info(`Approve spending for borrower with ${amount} of '${tokenName} (${tokenTicker})', address: ${tokenAddress}...`);
  const res = await erc20.approve(collateralAccount, amount);
  await res.wait();
};

export type AssetInfo = {
  name: string
  symbol: string
  decimals: number
  amount: string
  rate: BigNumberish
  haircut: BigNumberish
  tokenAddress: AddressLike
}

export const parseAssets = (assetsStr: string | undefined): AssetInfo[] => {
  if (!assetsStr) {
    return [];
  }
  const assetStrs = assetsStr.split(";").map((s) => s.trim());
  return assetStrs.map(parseAsset);
}

const parseAsset = (assetStr: string): AssetInfo => {
  const [name, symbol, decimalsStr, amount, rateStr, haircutStr] = assetStr.split(",").map((s) => s.trim());
  const decimals = parseInt(decimalsStr);
  const rate = parseUnits(rateStr, decimals);
  const haircut = parseInt(haircutStr);
  const tokenAddress = ZeroAddress;
  return { name, symbol, decimals, amount, rate, haircut, tokenAddress } as AssetInfo;
};

export type AccountInfo = {
  address: AddressLike
  finId: string
  privateKey: string
}

export const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const generateAssetId = (): string => {
  return `bank-us:102:${uuid()}`;
};

