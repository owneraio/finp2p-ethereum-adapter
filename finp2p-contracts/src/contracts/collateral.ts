import { ContractsManager } from "./manager";
import { ContractFactory, Provider, Signer } from "ethers";
import { IFinP2PCollateralBasketFactory } from "../../typechain-types";
import FINP2P_COLLATERAL_ASSET_FACTORY
  from "../../artifacts/contracts/token/collateral/finp2p/IFinP2PCollateralBasketFactory.sol/IFinP2PCollateralBasketFactory.json";
import winston from "winston";


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
  haircutContext: string;
  priceService: string;
  pricedInToken: string;
  liabilityAmount: number;
  liabilityAddress: string;
  assetContextList: string[];
}

export class FinP2PCollateralAssetFactoryContract extends ContractsManager {

  collateralAssetFactory: IFinP2PCollateralBasketFactory;

  constructor(provider: Provider, signer: Signer, contractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const afFactory = new ContractFactory<any[], IFinP2PCollateralBasketFactory>(
      FINP2P_COLLATERAL_ASSET_FACTORY.abi, FINP2P_COLLATERAL_ASSET_FACTORY.bytecode, this.signer
    );
    const afContract = afFactory.attach(contractAddress);
    this.collateralAssetFactory = afContract as IFinP2PCollateralBasketFactory;
  }

  async createCollateralAsset(name: string, description: string, basketId: string,
                              tokenAddresses: string[], quantities: string[],
                              source: string, destination: string, params: CollateralAssetParams) {
    return await this.collateralAssetFactory.createCollateralAsset(
      name, description, basketId, tokenAddresses, quantities, source, destination, params);
  }

}