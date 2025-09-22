import {
  BaseContract,
  ContractFactory,
  ContractTransactionResponse,
  NonceManager,
  Provider,
  Signer, TypedDataField
} from "ethers";
import FINP2P from "../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import ERC20 from "../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { ERC20WithOperator, FINP2POperatorERC20 } from "../typechain-types";
import winston from "winston";
import { PayableOverrides } from "../typechain-types/common";
import { EthereumTransactionError, NonceAlreadyBeenUsedError, NonceToHighError } from "./model";
import { hashEIP712, signEIP712 } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { compactSerialize } from "./utils";
import { detectError } from "./errors";

const DefaultDecimalsCurrencies = 2;

export class ContractsManager {

  provider: Provider;
  signer: Signer;
  logger: winston.Logger;

  constructor(provider: Provider, signer: Signer, logger: winston.Logger) {
    this.provider = provider;
    this.signer = signer;
    this.logger = logger;
    if (this.signer instanceof NonceManager) {
      this.signer.getNonce().then((nonce) => {
        this.logger.info(`Using nonce-manager, current nonce: ${nonce}`);
      });
    }
  }

  async deployERC20(name: string, symbol: string, decimals: number, finP2PContractAddress: string) {
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer
    );
    const contract = await factory.deploy(name, symbol, decimals, finP2PContractAddress);
    await contract.waitForDeployment();
    return await contract.getAddress();
  }

  async getPendingTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "pending");
  }

  async getLatestTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "latest");
  }

  async deployFinP2PContract(signerAddress: string | undefined, paymentAssetCode: string | undefined = undefined) {
    this.logger.info("Deploying FinP2P contract...");
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    this.logger.info(`FinP2P contract deployed successfully at: ${address}`);

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
    // logger.info(`Check FinP2P contract at ${finP2PContractAddress} on chain`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    try {
      await contract.getAssetAddress("test-asset-id");
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes("Asset not found")) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  async preCreatePaymentAsset(factory: ContractFactory<any[], FINP2POperatorERC20>, finP2PContractAddress: string, assetId: string, decimals: number): Promise<void> {
    this.logger.info(`Pre-creating payment asset ${assetId}...`);
    const tokenAddress = await this.deployERC20(assetId, assetId, decimals, finP2PContractAddress);

    const contract = factory.attach(finP2PContractAddress) as FINP2POperatorERC20;
    this.logger.info(`Associating asset ${assetId} with token ${tokenAddress}...`);
    const txHash = await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, txParams);
    });
    await this.waitForCompletion(txHash);
  }

  async grantAssetManagerRole(finP2PContractAddress: string, to: string) {
    this.logger.info(`Granting asset manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress) as FINP2POperatorERC20;
    const txHash = await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.grantAssetManagerRole(to, txParams);
    });
    await this.waitForCompletion(txHash);
  }

  async grantTransactionManagerRole(finP2PContractAddress: string, to: string) {
    this.logger.info(`Granting transaction manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress) as FINP2POperatorERC20;
    const txHash = await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.grantTransactionManagerRole(to, txParams);
    });
    await this.waitForCompletion(txHash);
  }

  async signEIP712(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>): Promise<{
    hash: string,
    signature: string
  }> {
    const hash = hashEIP712(chainId, verifyingContract, types, message).substring(2);
    const signature = compactSerialize(await signEIP712(chainId, verifyingContract, types, message, this.signer));
    return { hash, signature };
  }

  public async waitForCompletion(txHash: string, tries: number = 300) {
    for (let i = 1; i < tries; i++) {
      const txReceipt = await this.provider.getTransactionReceipt(txHash);
      if (txReceipt !== null) {
        if (txReceipt.status === 1) {
          return txReceipt;
        } else {
          throw new Error(`transaction failed: ${txHash}`);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no result after ${tries} retries`);
  }

  protected async safeExecuteTransaction<C extends BaseContract>(contract: C, call: (contract: C, overrides: PayableOverrides) => Promise<ContractTransactionResponse>, maxAttempts: number = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        let nonce: number;
        if (this.signer instanceof NonceManager) {
          nonce = await (this.signer as NonceManager).getNonce();
        } else {
          nonce = await this.getLatestTransactionCount();
        }
        const response = await call(contract, { nonce });
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

  private resetNonce() {
    if (this.signer instanceof NonceManager) {
      (this.signer as NonceManager).reset();
    }
  }
}
