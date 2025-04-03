import { ContractsManager } from "./manager";
import { ContractFactory, Provider, Signer } from "ethers";
import { IAccountFactory } from "../../typechain-types";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import winston from "winston";


export class AccountFactoryContract extends ContractsManager {

  accountFactory: IAccountFactory;

  tokenAddress: string;

  constructor(provider: Provider, signer: Signer, tokenAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    this.tokenAddress = tokenAddress;
    const afFactory = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, this.signer
    );
    const afContract = afFactory.attach(tokenAddress);
    this.accountFactory = afContract as IAccountFactory;
  }

  async createAccount(name: string, description: string, strategyId: string, controller: string, initParams: string, strategyInput: string) {
    return await this.accountFactory.createAccount(name, description, strategyId, controller, initParams, strategyInput);
  }

}