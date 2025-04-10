import { ContractsManager } from "./manager";
import { ContractFactory, Provider, Signer } from "ethers";
import { IFinP2PCollateralBasketFactory } from "../../typechain-types";
import FINP2P_COLLATERAL_ASSET_FACTORY
  from "../../artifacts/contracts/token/collateral/finp2p/IFinP2PCollateralBasketFactory.sol/IFinP2PCollateralBasketFactory.json";
import winston from "winston";

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
  assetContextList: string[];
}

export class FinP2PCollateralAssetFactoryContract extends ContractsManager {

  contract: IFinP2PCollateralBasketFactory;

  constructor(provider: Provider, signer: Signer, contractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], IFinP2PCollateralBasketFactory>(
      FINP2P_COLLATERAL_ASSET_FACTORY.abi, FINP2P_COLLATERAL_ASSET_FACTORY.bytecode, this.signer
    );
    const contract = factory.attach(contractAddress);
    this.contract = contract as IFinP2PCollateralBasketFactory;
  }

  async createCollateralAsset(name: string, description: string, basketId: string,
                              tokenAddresses: string[], quantities: string[],
                              source: string, destination: string, params: CollateralAssetParams) {
    return await this.contract.createCollateralAsset(
      name, description, basketId, tokenAddresses, quantities, source, destination, params);
  }

  async getBasketAccount(basketId: string) {
    return await this.contract.getBasketAccount(basketId);
  }

  async getBasketState(basketId: string) {
    return await this.contract.getBasketState(basketId);
  }

}