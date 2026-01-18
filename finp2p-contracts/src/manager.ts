import {
  BaseContract,
  BytesLike,
  ContractFactory,
  ContractTransactionReceipt,
  ContractTransactionResponse,
  NonceManager,
  Provider,
  Signer, TypedDataField
} from "ethers";
import FINP2P from "../artifacts/contracts/finp2p/FINP2POperator.sol/FINP2POperator.json";
import ASSET_REGISTRY from "../artifacts/contracts/utils/finp2p/AssetRegistry.sol/AssetRegistry.json";
import ERC20_STANDARD from "../artifacts/contracts/utils/erc20/ERC20Standard.sol/ERC20Standard.json";
import ERC20 from "../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { AssetRegistry, ERC20Standard, ERC20WithOperator, FINP2POperator } from "../typechain-types";
import { Logger } from "@owneraio/finp2p-adapter-models";
import { PayableOverrides } from "../typechain-types/common";
import { ERC20_STANDARD_ID, EthereumTransactionError, NonceAlreadyBeenUsedError, NonceTooHighError } from "./model";
import { compactSerialize, hashEIP712, signEIP712 } from "./utils";
import { detectError } from "./errors";

const DefaultDecimalsCurrencies = 2;

export class ContractsManager {
  provider: Provider;
  signer: Signer;
  logger: Logger;

  constructor(provider: Provider, signer: Signer, logger: Logger) {
    this.provider = provider;
    this.signer = signer;
    this.logger = logger;
    if (this.signer instanceof NonceManager) {
      this.signer.getNonce().then((nonce) => {
        this.logger.info(`Using nonce-manager, current nonce: ${nonce}`);
      });
    }
  }

  async deployERC20Detached(name: string, symbol: string, decimals: number, operatorAddress: string): Promise<string> {
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer
    );
    const contract = await factory.deploy(name, symbol, decimals, operatorAddress);
    await contract.waitForDeployment();
    return await contract.getAddress();
  }

  async deployERC20ViaAssetRegistry(name: string, symbol: string, decimals: number, finP2PContractAddress: string) {
    const standardAddress = await this.getAssetStandardViaFinP2PContract(finP2PContractAddress, ERC20_STANDARD_ID);

    return this.deployERC20Detached(name, symbol, decimals, standardAddress)
  }

  async getPendingTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "pending");
  }

  async getLatestTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "latest");
  }

  async deployAssetRegistryContract() {
    this.logger.info("Deploying asset registry....");
    const factory = new ContractFactory<any[], AssetRegistry>(
      ASSET_REGISTRY.abi, ASSET_REGISTRY.bytecode, this.signer
    );
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    return await contract.getAddress();
  }

  async deployERC20StandardContract(executorAddress: string) {
    this.logger.info("Deploying ERC20 standard contract...");
    const factory = new ContractFactory<any[], ERC20Standard>(
      ERC20_STANDARD.abi, ERC20_STANDARD.bytecode, this.signer
    );
    const contract = await factory.deploy(executorAddress);
    await contract.waitForDeployment();

    return await contract.getAddress();
  }

  async deployFinP2PContract(operatorAddress: string | undefined, paymentAssetCode: string | undefined = undefined) {
    const assetRegistryAddress = await this.deployAssetRegistryContract();
    this.logger.info(`Asset registry deployed at: ${assetRegistryAddress}`);


    this.logger.info("Deploying FinP2P contract...");
    const factory = new ContractFactory<any[], FINP2POperator>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const deployerAddress = await this.signer.getAddress();
    const contract = await factory.deploy(deployerAddress, assetRegistryAddress);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    this.logger.info(`FinP2P contract deployed successfully at: ${address}`);

    if (operatorAddress) {
      await this.grantAssetManagerRole(address, operatorAddress);
      await this.grantTransactionManagerRole(address, operatorAddress);
    }

    if (paymentAssetCode) {
      await this.preCreatePaymentAsset(factory, address, paymentAssetCode, DefaultDecimalsCurrencies);
    }

    const erc20StandardAddress = await this.deployERC20StandardContract(address);
    this.logger.info(`ERC20 standard deployed at: ${erc20StandardAddress}`);

    await this.registerAssetStandard(assetRegistryAddress, ERC20_STANDARD_ID, erc20StandardAddress);

    return address;
  }

  async isFinP2PContractHealthy(finP2PContractAddress: string): Promise<boolean> {
    // logger.info(`Check FinP2P contract at ${finP2PContractAddress} on chain`);
    const factory = new ContractFactory<any[], FINP2POperator>(
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

  async preCreatePaymentAsset(factory: ContractFactory<any[], FINP2POperator>, finP2PContractAddress: string, assetId: string, decimals: number): Promise<void> {
    this.logger.info(`Pre-creating payment asset ${assetId}...`);
    const tokenAddress = await this.deployERC20ViaAssetRegistry(assetId, assetId, decimals, finP2PContractAddress);

    const contract = factory.attach(finP2PContractAddress) as FINP2POperator;
    this.logger.info(`Associating asset ${assetId} with token ${tokenAddress}...`);
    await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, ERC20_STANDARD_ID, txParams);
    });
  }

  async grantAssetManagerRole(finP2PContractAddress: string, to: string) {
    this.logger.info(`Granting asset manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperator>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress) as FINP2POperator;
    await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.grantAssetManagerRole(to, txParams);
    });
  }

  async grantTransactionManagerRole(finP2PContractAddress: string, to: string) {
    this.logger.info(`Granting transaction manager role to ${to}...`);
    const factory = new ContractFactory<any[], FINP2POperator>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress) as FINP2POperator;
    await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.grantTransactionManagerRole(to, txParams);
    });
  }

  async registerAssetStandard(assetRegistryAddress: string, standardId: BytesLike, erc20StandardAddress: string) {
    const assetRegistryFactory = new ContractFactory<any[], AssetRegistry>(ASSET_REGISTRY.abi, ASSET_REGISTRY.bytecode, this.signer);
    const assetRegistry = assetRegistryFactory.attach(assetRegistryAddress);
    await assetRegistry.registerAssetStandard(standardId, erc20StandardAddress);
  }

  async getAssetStandard(assetRegistryAddress: string, tokenStandard: BytesLike) {
    const assetRegistryFactory = new ContractFactory<any[], AssetRegistry>(ASSET_REGISTRY.abi, ASSET_REGISTRY.bytecode, this.signer);
    const assetRegistry = assetRegistryFactory.attach(assetRegistryAddress);
    return await assetRegistry.getAssetStandard(tokenStandard);
  }

  async getAssetStandardViaFinP2PContract(finP2PContractAddress: string, tokenStandard: BytesLike) {
    const finp2PFactory = new ContractFactory<any[], FINP2POperator>(FINP2P.abi, FINP2P.bytecode, this.signer);
    const finP2PContract = finp2PFactory.attach(finP2PContractAddress);

    const assetRegistryAddress = await finP2PContract.getAssetRegistry();
    return this.getAssetStandard(assetRegistryAddress, tokenStandard)
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

  protected async mapErrors<R>(callee: () => Promise<R>) {
    try {
      return await callee()
    } catch (e) {
      throw detectError(e)
    }
  }

  protected async safeExecuteTransaction<C extends BaseContract>(contract: C, call: (contract: C, overrides: PayableOverrides) => Promise<ContractTransactionResponse>, maxAttempts: number = 10): Promise<ContractTransactionReceipt> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        let nonce: number;
        if (this.signer instanceof NonceManager) {
          nonce = await (this.signer as NonceManager).getNonce();
        } else {
          nonce = await this.getLatestTransactionCount();
        }
        const response = await call(contract, { nonce })
        const receipt = await response.wait(undefined, 60_000) // wait for 1 confirmation and max 60 s
        if (receipt !== null) {
          return receipt
        } else {
          continue
        }
      } catch (e) {
        const err = detectError(e);
        if (err instanceof EthereumTransactionError) {
          // console.log('Ethereum transaction error');
          this.resetNonce();
          throw err;

        } else if (err instanceof NonceTooHighError) {
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
