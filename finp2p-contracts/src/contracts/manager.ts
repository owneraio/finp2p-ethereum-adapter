import {
  ContractFactory, NonceManager, Provider, Signer
} from "ethers";
import FINP2P from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import ERC20 from '../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json';
import { ERC20WithOperator, FINP2POperatorERC20 } from '../../typechain-types';

const DefaultDecimalsCurrencies = 2;

export class ContractsManager {

  provider: Provider;
  signer: Signer;

  constructor(provider: Provider, signer: Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  async deployERC20(name: string, symbol: string, decimals: number, finP2PContractAddress: string) {
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer,
    );
    const contract = await factory.deploy(name, symbol, decimals, finP2PContractAddress);
    await contract.waitForDeployment();
    return await contract.getAddress();
  }

  async deployFinP2PContract(signerAddress: string | undefined, paymentAssetCode: string | undefined = undefined) {
    console.log('Deploying FinP2P contract...');
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log('FinP2P contract deployed successfully at:', address);

    if (signerAddress) {
      await this.grantAssetManagerRole(address, signerAddress);
      await this.grantTransactionManagerRole(address, signerAddress);
    }

    if (paymentAssetCode) {
      await this.preCreatePaymentAsset(factory, address, paymentAssetCode, DefaultDecimalsCurrencies);
    }

    return address;
  }

  async isFinP2PContractHealthy(finP2PContractAddress: string): Promise<boolean> {
    // console.log(`Check FinP2P contract at ${finP2PContractAddress} on chain`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    try {
      await contract.getAssetAddress('test-asset-id');
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('Asset not found')) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  async preCreatePaymentAsset(factory: ContractFactory<any[], FINP2POperatorERC20>, finP2PContractAddress: string, assetId: string, decimals: number): Promise<void> {
    console.log(`Pre-creating payment asset ${assetId}...`);
    const tokenAddress = await this.deployERC20(assetId, assetId, decimals, finP2PContractAddress);

    const contract = factory.attach(finP2PContractAddress);

    console.log(`Associating asset ${assetId} with token ${tokenAddress}...`);
    const tx = await contract.associateAsset(assetId, tokenAddress);
    await this.waitForCompletion(tx.hash);
  }

  async grantAssetManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting asset manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    const tx = await contract.grantAssetManagerRole(to);
    await this.waitForCompletion(tx.hash);
  }

  async grantTransactionManagerRole(finP2PContractAddress: string, to: string) {
    console.log(`Granting transaction manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    const tx = await contract.grantTransactionManagerRole(to);
    await this.waitForCompletion(tx.hash);
  }

  public async waitForCompletion(txHash: string, tries: number = 300) {
    for (let i = 1; i < tries; i++) {
      const txReceipt = await this.provider.getTransactionReceipt(txHash);
      if (txReceipt !== null) {
        if (txReceipt.status === 1) {
          return;
        } else {
          throw new Error(`transaction failed: ${txHash}`);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }

  protected resetNonce() {
    (this.signer as NonceManager).reset();
  }
}