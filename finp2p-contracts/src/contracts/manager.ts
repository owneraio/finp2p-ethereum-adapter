import {
  ContractFactory, ContractTransactionResponse, Provider, Signer
} from "ethers";
import FINP2P from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import ERC20 from '../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json';
import { ERC20WithOperator, FINP2POperatorERC20 } from '../../typechain-types';
import { detectError, EthereumTransactionError, NonceAlreadyBeenUsedError, NonceToHighError } from "./model";

const DEFAULT_HASH_TYPE = 2; // EIP712

export class ContractsManager {

  provider: Provider;
  signer: Signer;

  constructor(provider: Provider, signer: Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  async deployERC20(name: string, symbol: string, finP2PContractAddress: string) {
     // console.log("Deploying ERC20 contract...");
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer,
    );
    const contract = await factory.deploy(name, symbol, finP2PContractAddress);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    // console.log("ERC20 contract deployed successfully at:", address);
    return address;
  }

  async deployFinP2PContract(signerAddress: string | undefined, paymentAssetCode: string | undefined = undefined, hashType: number | undefined = DEFAULT_HASH_TYPE) {
    console.log('Deploying FinP2P contract...');
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = await factory.deploy(hashType);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log('FinP2P contract deployed successfully at:', address);

    if (signerAddress) {
      await this.grantAssetManagerRole(address, signerAddress);
      await this.grantTransactionManagerRole(address, signerAddress);
    }

    if (paymentAssetCode) {
      await this.preCreatePaymentAsset(factory, address, paymentAssetCode);
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

  async preCreatePaymentAsset(factory: ContractFactory<any[], FINP2POperatorERC20>, finP2PContractAddress: string, assetId: string): Promise<void> {
    console.log(`Pre-creating payment asset ${assetId}...`);
    const tokenAddress = await this.deployERC20(assetId, assetId, finP2PContractAddress);

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

  async safeExecuteTransaction(call: () => Promise<ContractTransactionResponse>, maxAttempts: number = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await call();
        return response.hash;
      } catch (e) {
        const err = detectError(e);
        if (err instanceof EthereumTransactionError) {
          // console.log('Ethereum transaction error');
          this.resetNonce();
          throw err;

        } else if (err instanceof NonceToHighError) {
          // console.log('Nonce too high error, retrying');
          this.resetNonce();
          // continuing the loop
        } else if (err instanceof NonceAlreadyBeenUsedError) {
          // console.log('Nonce already been used error, retrying');
          this.resetNonce();
          // continuing the loop
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed to execute transaction without nonce-too-high error after ${maxAttempts} attempts`);
  }

  protected resetNonce() {
    // (this.signer as NonceManager).reset();
  }
}