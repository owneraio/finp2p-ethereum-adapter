import {
  ERC20WithOperator,
  IAccountFactory,
  IAssetCollateralAccount
} from "../../typechain-types";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import ASSET_COLLATERAL_CONTRACT
  from "../../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import {
  AbiCoder,
  AddressLike,
  BigNumberish,
  ContractFactory,
  keccak256,
  parseUnits, Provider,
  Signer,
  toUtf8Bytes, TransactionReceipt, ZeroAddress
} from "ethers";
import {
  AccountCreatedEvent,
  IAccountFactoryInterface
} from "../../typechain-types/contracts/token/collateral/IAccountFactory";
import { ContractsManager } from "./manager";
import winston from "winston";
import { PayableOverrides } from "../../typechain-types/common";


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

export class AccountFactory extends ContractsManager {
  contract: IAccountFactory;

  constructor(provider: Provider, signer: Signer, contractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger)
    this.contract = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, signer
    ).attach(contractAddress as string) as IAccountFactory;
  }

  async createAccount(
    provider: AddressLike,
    receiver: AddressLike,
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
      provider, receiver, liabilityFactory
    ];

    const strategyInput = {
      assetContextList,
      addressList,
      amountList,
      effectiveTimeList: [],
      liabilityDataList: []
    };

    const txHash = await this.safeExecuteTransaction(this.contract, async (account: IAccountFactory, txParams: PayableOverrides) => {
      return account.createAccount(
        name, description, strategyId, controller, initParams, strategyInput, txParams
      );
    });

    const receipt = await this.waitForCompletion(txHash)
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
    const { address: collateralAddress } = parseCreateAccount(receipt, this.contract.interface);

    return collateralAddress;
  };

}


export class AssetCollateralAccount extends ContractsManager {
  contract: IAssetCollateralAccount;

  constructor(provider: Provider, signer: Signer, contractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
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
    effectiveTime: number = 0, // Open ended
    priceType: PriceType = PriceType.DEFAULT
  ) {
    return this.safeExecuteTransaction(this.contract, async (account: IAssetCollateralAccount, txParams: PayableOverrides) => {
      return account.setConfigurationBundle(
        targetRatio, defaultRatio, targetRatioLimit, defaultRatioLimit, priceType,
        haircutContext, priceService, pricedInToken,
        {
          liabilityAddress: ZeroAddress,
          amount: liabilityAmount,
          pricedInToken,
          effectiveTime
        },
        assetContextList,
        txParams
      );
    });
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
    return this.safeExecuteTransaction(this.contract, async (account: IAssetCollateralAccount, txParams: PayableOverrides) => {
      return account.setAllowableCollateral(assetList, txParams);
    });
  }


  async deposit(tokenAddress: AddressLike, amount: BigNumberish) {
    const asset: IAssetCollateralAccount.AssetStruct = {
      standard: AssetStandard.FUNGIBLE,
      addr: tokenAddress,
      tokenId: 0
    };
    return this.safeExecuteTransaction(this.contract, async (account: IAssetCollateralAccount, txParams: PayableOverrides) => {
      return account.deposit(asset, amount, txParams);
    });
  };

  async release() {
    return this.safeExecuteTransaction(this.contract, async (account: IAssetCollateralAccount, txParams: PayableOverrides) => {
      return account.release(txParams);
    });
  };
}