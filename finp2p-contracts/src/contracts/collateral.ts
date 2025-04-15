import {
  IAccountFactory,
  IAssetCollateralAccount
} from "../../typechain-types";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import ASSET_COLLATERAL_CONTRACT
  from "../../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory,
  keccak256,
  parseUnits,
  Signer,
  toUtf8Bytes, TransactionReceipt, ZeroAddress
} from "ethers";
import {
  AccountCreatedEvent,
  IAccountFactoryInterface
} from "../../typechain-types/contracts/token/collateral/IAccountFactory";



export type CollateralAssetMetadata = {
  collateralAccount: string
  tokenAddresses: string[],
  amounts: string[],
  borrower: string,
  lender: string
}

export enum CollateralType {
  CCP_MARGIN,
  REPO
}

export enum AssetStandard {
  NETWORK, //ETHER,
  FUNGIBLE, //ERC20,
  NON_FUNGIBLE, //ERC721,
  PART_FUNGIBLE, //ERC1155,
  ITEM, //Composer non-fungible item
  OTHER
}

export enum PriceType {
  DEFAULT,
  MARKET,
  BID,
  ASK,
  NAV,
  NPV,
  LIQUIDATION
}

export interface CollateralAssetParams {
  // targetRatio: number;
  // defaultRatio: number;
  // targetRatioLimit: number;
  // defaultRatioLimit: number;
  // priceType: PriceType;
  controller: string;
  haircutContext: string;
  priceService: string;
  pricedInToken: string;
  liabilityAmount: number;
  // liabilityAddress: string;
  // assetContextList: string[];
}

export const parseCreateAccount = (receipt: TransactionReceipt,
                                   contractInterface: IAccountFactoryInterface): {
  address: string,
  id: bigint
} => {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === "AccountCreated") {
        const { account, accountId } = parsed.args as unknown as AccountCreatedEvent.OutputObject;
        return { address: account, id: accountId };
      }
    } catch (e) {
      // do nothing
    }
  }
  throw new Error("Failed to parse create account");
};

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
      ({ standard, addr, tokenId } as IAssetCollateralAccount.AssetStruct));
    const rsp = await this.contract.setAllowableCollateral(assetList);
    await rsp.wait();
  }


  async deposit(tokenAddress: AddressLike, amount: BigNumberish) {
    const asset: IAssetCollateralAccount.AssetStruct = {
      standard: AssetStandard.FUNGIBLE,
      addr: tokenAddress,
      tokenId: 0
    };
    const rsp = await this.contract.deposit(asset, amount);
    await rsp.wait();
  };

  async release() {
    const rsp = await this.contract.release();
    await rsp.wait();
  };
}