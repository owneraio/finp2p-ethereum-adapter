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
    this.signer = new NonceManager(new Wallet(signerPrivateKey)).connect(this.provider);
  }

  async deployERC20(name: string, symbol: string, finP2PContractAddress: string) {
    console.log("Deploying ERC20 contract...");
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer
    );
    const contract = await factory.deploy(name, symbol, finP2PContractAddress);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log("ERC20 contract deployed successfully at:", address);
    return address;
  }

  async deployFinP2PContract(signerAddress: string | null) {
    console.log("Deploying FinP2P contract...");
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("FinP2P contract deployed successfully at:", address);

    if (signerAddress !== null) {
      await this.grantAssetManagerRole(address, signerAddress);
      await this.grantTransactionManagerRole(address, signerAddress);
    }

    return address;
  }

  async grantAssetManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting asset manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    const tx = await contract.grantAssetManagerRole(to);
    await this.waitForCompletion(tx.hash);
  }

  async grantTransactionManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting transaction manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    const tx = await contract.grantTransactionManagerRole(to);
    await this.waitForCompletion(tx.hash);
  }

  private async waitForCompletion(txHash: string, tries: number = 300) {
    for (let i = 1; i < tries; i++) {
      const txReceipt = await this.provider.getTransactionReceipt(txHash);
      if (txReceipt !== null) {
        if (txReceipt.status === 1) {
          return;
        } else {
          throw new Error(`transaction failed: ${txHash}`);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }
}