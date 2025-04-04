import { ContractsManager } from "./manager";
import { ContractFactory, Provider, Signer } from "ethers";
import { IAssetCollateralAccount } from "../../typechain-types";
import COLLATERAL_ACCOUNT
  from "../../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import winston from "winston";


enum AssetStandard {
  NETWORK, //ETHER,
  FUNGIBLE, //ERC20,
  NON_FUNGIBLE, //ERC721,
  PART_FUNGIBLE, //ERC1155,
  ITEM, //Composer non-fungible item
  OTHER
}

export class CollateralAssetContract extends ContractsManager {

  collateralAccount: IAssetCollateralAccount;

  constructor(provider: Provider, signer: Signer, contractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const afFactory = new ContractFactory<any[], IAssetCollateralAccount>(
      COLLATERAL_ACCOUNT.abi, COLLATERAL_ACCOUNT.bytecode, this.signer
    );
    const afContract = afFactory.attach(contractAddress);
    this.collateralAccount = afContract as IAssetCollateralAccount;
  }

  async deposit(assetAddress: string, amount: number) {
    return await this.collateralAccount.deposit({
      standard: AssetStandard.FUNGIBLE,
      addr: assetAddress,
      tokenId: 0
    }, amount)
  }

  async release() {
    return await this.collateralAccount.release()
  }

  async forward() {
    return await this.collateralAccount.forward()
  }

  async setAllowableCollateral(assetList: string[]) {
    return await this.collateralAccount.setAllowableCollateral(assetList)
  }

  // async setConfigurationBundle() {
  //   return await this.collateralAccount.setConfigurationBundle(
  //
  //   )
  // }
  //

  //  function setAllowableCollateral(
  //         address[] memory assetList
  //     ) external;
  //
  //     function setPricedItemConfiguration(
  //         address priceService,
  //         address pricedInToken,
  //         uint256 priceType
  //     ) external;
  //
  //     function setConfigurationBundle(
  //         uint256 targetRatio,
  //         uint256 defaultRatio,
  //         uint256 targetRatioLimit,
  //         uint256 defaultRatioLimit,
  //         uint256 priceType,
  //         address haircutContext,
  //         address priceService,
  //         address pricedInToken,
  //         LiabilityData memory liabilityData,
  //         address[] memory assetContextList
  //     ) external;

  //


}