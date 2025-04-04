import { ContractsManager } from "./manager";
import { AddressLike, BytesLike, ContractFactory, Provider, Signer } from "ethers";
import { IAccountFactory } from "../../typechain-types";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
import winston from "winston";


export class AccountFactoryContract extends ContractsManager {

  accountFactory: IAccountFactory;

  constructor(provider: Provider, signer: Signer, factoryAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const afFactory = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, this.signer
    );
    const afContract = afFactory.attach(factoryAddress);
    this.accountFactory = afContract as IAccountFactory;
  }

  async createAccount(name: string, description: string, strategyId: BytesLike, controller: AddressLike, initParams: BytesLike, strategyInput: IAccountFactory.StrategyInputStruct) {
    return await this.accountFactory.createAccount(name, description, strategyId, controller, initParams, strategyInput);
  }

  async getLiabilityFactory() {
    return await this.accountFactory.getLiabilityFactory();
  }

  async controller() {
    return await this.accountFactory.controller();
  }
}