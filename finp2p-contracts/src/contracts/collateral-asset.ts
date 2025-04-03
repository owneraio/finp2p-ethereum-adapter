import { ContractsManager } from "./manager";
import { ContractFactory, Provider, Signer } from "ethers";
import { IAssetCollateralAccount } from "../../typechain-types";
import COLLATERAL_ACCOUNT from "../../artifacts/contracts/token/collateral/IAssetCollateralAccount.sol/IAssetCollateralAccount.json";
import winston from "winston";


export class CollateralAssetContract extends ContractsManager {

  collateralAccount: IAssetCollateralAccount;

  tokenAddress: string;

  constructor(provider: Provider, signer: Signer, tokenAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    this.tokenAddress = tokenAddress;
    const afFactory = new ContractFactory<any[], IAssetCollateralAccount>(
      COLLATERAL_ACCOUNT.abi, COLLATERAL_ACCOUNT.bytecode, this.signer
    );
    const afContract = afFactory.attach(tokenAddress);
    this.collateralAccount = afContract as IAssetCollateralAccount;
  }


}