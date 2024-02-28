import { ContractFactory, JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";
import console from "console";
import FINP2P from "../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { ERC20WithOperator, FINP2POperatorERC20 } from "../../typechain-types";


export class ContractsManager {

  provider: Provider;
  signer: Signer;

  constructor(rpcURL: string, signerPrivateKey: string) {
    this.provider = new JsonRpcProvider(rpcURL);
    this.signer = new NonceManager(new Wallet(signerPrivateKey, this.provider));
  }

  async deployERC20(name: string, symbol: string, finP2PContractAddress: string) {
    console.log("Deploying ERC20 contract...");
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer
    );
    const contract = await factory.deploy(name, symbol, finP2PContractAddress);
    const address = await contract.getAddress();
    console.log("ERC20 contract deployed successfully at:", address);
    return address;
  }

  async deployFinP2PContract() {
    console.log("Deploying FinP2P contract...");
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = await factory.deploy();
    const address = await contract.getAddress();
    console.log("FinP2P contract deployed successfully at:", address);
    return address;
  }

  async grantAssetManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting asset manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    await contract.grantAssetManagerRole(to);
  }

  async grantTransactionManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting transaction manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    await contract.grantTransactionManagerRole(to);
  }
}