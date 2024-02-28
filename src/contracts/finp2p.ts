import { Interface, JsonRpcProvider, Wallet, Contract, ContractFactory } from "ethers";
import FINP2POperatorERC20
  from "../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { IFinP2PAsset, IFinP2PEscrow } from "../../typechain-types";
import { FinP2PReceipt, OperationStatus } from "./model";
import console from "console";
import { parseTransactionReceipt } from "./utils";

type IFinP2P = IFinP2PAsset & IFinP2PEscrow

export class FinP2PContract {

  provider: JsonRpcProvider;

  signer: Wallet;

  contractInterface: Interface;

  finP2P: IFinP2P;

  finP2PContractAddress: string;

  constructor(rpcURL: string, privateKey: string, finP2PContractAddress: string) {
    this.provider = new JsonRpcProvider(rpcURL);
    this.provider.pollingInterval = 500;
    this.signer = new Wallet(privateKey, this.provider);
    const genericContract = new Contract(
      finP2PContractAddress,
      FINP2POperatorERC20.abi,
      this.signer.connect(this.provider));
    this.contractInterface = genericContract.interface;
    this.finP2P = genericContract as unknown as IFinP2P;
    this.finP2PContractAddress = finP2PContractAddress;
  }

  async deployFinP2PContract() {
    console.log("Deploying FinP2P contract...");
    const factory = new ContractFactory(FINP2POperatorERC20.abi, FINP2POperatorERC20.bytecode, this.signer);
    const contract = await factory.deploy();
    const address = await contract.getAddress();
    console.log("FinP2P contract deployed successfully at:", address);

    return address;
  }

  async deployERC20(name: string, symbol: string) {
    console.log("Deploying ERC20 contract...");
    const factory = new ContractFactory(ERC20.abi, ERC20.bytecode, this.signer);
    const contract = await factory.deploy(name, symbol, this.finP2PContractAddress);
    const address = await contract.getAddress();
    console.log("ERC20 contract deployed successfully at:", address);

    return address;
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    const response = await this.finP2P.associateAsset(assetId, tokenAddress);
    return response.hash;
  }

  async issue(assetId: string, issuerFinId: string, quantity: number) {
    const response = await this.finP2P.issue(assetId, issuerFinId, quantity);
    return response.hash;
  }

  async transfer(nonce: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number,
                 settlementHash: string, hash: string, signature: string) {
    const response = await this.finP2P.transfer(
      `0x${nonce}`, assetId, sourceFinId, destinationFinId, quantity,
      `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async redeem(nonce: string, assetId: string, finId: string, quantity: number,
               settlementHash: string, hash: string, signature: string) {
    const response = await this.finP2P.redeem(`0x${nonce}`, assetId, finId, quantity,
      `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async hold(operationId: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number, expiry: number,
             assetHash: string, hash: string, signature: string) {
    const response = await this.finP2P.hold(`0x${operationId}`, assetId, sourceFinId, destinationFinId, quantity, expiry,
      `0x${assetHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async release(operationId: string, destinationFinId: string) {
    const response = await this.finP2P.release(`0x${operationId}`, destinationFinId);
    return response.hash;
  }

  async rollback(operationId: string) {
    const response = await this.finP2P.rollback(`0x${operationId}`);
    return response.hash;
  }

  async balance(assetId: string, finId: string) {
    return this.finP2P.getBalance(assetId, finId);
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt === null) {
      return {
        status: "pending"
      };
    } else if (receipt?.status === 1) {
      return {
        status: "completed",
        receipt: await parseTransactionReceipt(receipt, this.contractInterface)
      };
    } else {
      return {
        status: "failed",
        error: {
          code: 1,
          message: "Operation failed"
        }
      };
    }
  }

  async getReceipt(hash: string): Promise<FinP2PReceipt> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt === null) {
      throw new Error("Transaction not found");
    }
    return parseTransactionReceipt(receipt, this.contractInterface);
  }

}
