import { ContractsManager } from "./manager";
import { AbiCoder, AddressLike, BytesLike, ContractFactory, keccak256, Provider, Signer, toUtf8Bytes } from "ethers";
import { IAccountFactory } from "../../typechain-types";
import ACCOUNT_FACTORY from "../../artifacts/contracts/token/collateral/IAccountFactory.sol/IAccountFactory.json";
// import ACCOUNT_FACTORY from "../../IAccountFactory.json";
import winston from "winston";
import { IAccountFactoryInterface } from "../../typechain-types/contracts/token/collateral/IAccountFactory";


// Hardcoded constants
const COLLA_STRATEGY_ID = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy"));

const DECIMALS = 18;
const COLLATERAL_TYPE_REPO = 1; // 1 represents CollateralType.REPO enum

export class AccountFactoryContract extends ContractsManager {

  accountFactory: IAccountFactory;
  contractInterface: IAccountFactoryInterface;

  constructor(provider: Provider, signer: Signer, factoryAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], IAccountFactory>(
      ACCOUNT_FACTORY.abi, ACCOUNT_FACTORY.bytecode, this.signer
    );
    const contract = factory.attach(factoryAddress);
    this.contractInterface = contract.interface as IAccountFactoryInterface;
    this.accountFactory = contract as IAccountFactory;
  }

  async createRepoAgreement(name: string, description: string, source: AddressLike, destination: AddressLike) {
    const liabilityFactoryAddress = await this.getLiabilityFactory();
    const controller = await this.controller();

    const initParams = new AbiCoder().encode(
      ["uint8", "uint8", "uint256", "uint256"],
      [DECIMALS, COLLATERAL_TYPE_REPO, 0, 0]
    );

    const strategyInput = {
      assetContextList: [],
      addressList: [source, destination, liabilityFactoryAddress],
      amountList: [],
      effectiveTimeList: [],
      liabilityDataList: []
    };

    const rsp = await this.accountFactory.createAccount(name, description, COLLA_STRATEGY_ID, controller, initParams, strategyInput);
    const receipt = await rsp.wait();
    if (!receipt) {
      throw new Error("Failed to get transaction receipt");
    }
    for (const log of receipt.logs) {
      try {
        const parsed = this.contractInterface.parseLog(log);
        if (parsed && parsed.name === "AccountCreated") {
          const { account, accountId } = parsed.args;
          return { address: account, id: accountId };
        }
      } catch (e) {
        // This log didn't match the ABI — skip
        continue;
      }
    }
    throw new Error("Failed to create account");
  }

  async getLiabilityFactory() {
    return await this.accountFactory.getLiabilityFactory();
  }

  async controller() {
    return await this.accountFactory.controller();
  }
}