import {
  BaseContract,
  ContractFactory,
  ContractTransactionReceipt,
  ContractTransactionResponse,
  NonceManager,
  Provider,
  Signer, TypedDataField
} from "ethers";
import FINP2P from "../artifacts/contracts/finp2p/FINP2POperator.sol/FINP2POperator.json";
import ERC20 from "../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { ERC20WithOperator, FINP2POperator } from "../typechain-types";
import { Logger } from "./adapter-types";
import { PayableOverrides } from "../typechain-types/common";
import { EthereumTransactionError, NonceAlreadyBeenUsedError, NonceTooHighError } from "./model";
import { compactSerialize, hashEIP712, signEIP712 } from "./utils";
import { detectError } from "./errors";

const DefaultDecimalsCurrencies = 2;

/**
 * Default per-attempt wait for one block confirmation in `safeExecuteTransaction`.
 * 10 minutes — chosen to absorb transient slowness on public testnets (Sepolia
 * under load, Hashio, Hedera testnets) where confirming one block can stretch
 * well past a minute. Operators can override via the `confirmationTimeoutMs`
 * constructor option (typically threaded from a `TX_CONFIRMATION_TIMEOUT_MS`
 * env in the consuming app).
 *
 * Hitting this deadline doesn't necessarily mean the tx failed on-chain — it
 * may still confirm later; see issue #251 for the follow-up "report PENDING +
 * keep polling" work that turns this into a non-terminal signal.
 */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 600_000;

/**
 * EIP-1559 inclusion-speed tier. Multiplies the node's `getFeeData()`
 * `maxPriorityFeePerGas` (and `maxFeePerGas` to preserve baseFee headroom)
 * to position the tx in the validator's priority queue.
 *
 *   • slow   — 0.75× node default. Underbid; OK when fees matter more than
 *              inclusion latency.
 *   • normal — 1.0× (no overrides applied, ethers' built-in default flows
 *              through). Backwards-compatible behavior — same as before
 *              this option existed.
 *   • fast   — 1.5× node default. Push tx near the front of the mempool
 *              priority queue when the chain is congested (e.g. Sepolia
 *              under load).
 *
 * The multipliers apply ON TOP of the node estimate, so if the chain is
 * already busy and the node returns elevated values, "fast" stays elevated
 * relative to that. Chains without a public mempool (Hashio / Hedera EVM
 * testnets) get no speedup — the validator orders txs by consensus, not
 * by tip — so the tier is a no-op there in practice.
 */
export type GasTier = 'slow' | 'normal' | 'fast';

const GAS_TIER_MULTIPLIER_BASIS_POINTS: Record<GasTier, number> = {
  slow: 750,
  normal: 1000,
  fast: 1500,
};

export const DEFAULT_GAS_TIER: GasTier = 'normal';

export class ContractsManager {
  provider: Provider;
  signer: Signer;
  logger: Logger;
  confirmationTimeoutMs: number;
  gasTier: GasTier;

  constructor(
    provider: Provider,
    signer: Signer,
    logger: Logger,
    confirmationTimeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS,
    gasTier: GasTier = DEFAULT_GAS_TIER,
  ) {
    this.provider = provider;
    this.signer = signer;
    this.logger = logger;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
    this.gasTier = gasTier;
    if (this.signer instanceof NonceManager) {
      this.signer.getNonce().then((nonce) => {
        this.logger.info(`Using nonce-manager, current nonce: ${nonce}`);
      });
    }
  }

  async deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string): Promise<string> {
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi,
      ERC20.bytecode,
      this.signer
    );
    const contract = await factory.deploy(name, symbol, decimals, operatorAddress);
    await contract.waitForDeployment();
    return await contract.getAddress();
  }

  async getPendingTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "pending");
  }

  async getLatestTransactionCount() {
    return await this.provider.getTransactionCount(this.signer.getAddress(), "latest");
  }

  async deployFinP2PContract(operatorAddress: string | undefined, paymentAssetCode: string | undefined = undefined) {
    this.logger.info("Deploying FinP2P contract...");
    const factory = new ContractFactory<any[], FINP2POperator>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const deployerAddress = await this.signer.getAddress();
    const contract = await factory.deploy(deployerAddress);
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

    return address;
  }

  async isFinP2PContractHealthy(finP2PContractAddress: string): Promise<boolean> {
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
    const finP2PAddress = await factory.attach(finP2PContractAddress).getAddress();
    const tokenAddress = await this.deployERC20(assetId, assetId, decimals, finP2PAddress);

    const contract = factory.attach(finP2PContractAddress) as FINP2POperator;
    this.logger.info(`Associating asset ${assetId} with token ${tokenAddress}...`);
    await this.safeExecuteTransaction(contract, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, txParams);
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
        const overrides = await this.buildTxOverrides(nonce);
        const response = await call(contract, overrides)
        const receipt = await response.wait(undefined, this.confirmationTimeoutMs) // wait for 1 confirmation
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

  /**
   * Build the per-attempt tx overrides for `safeExecuteTransaction`.
   *
   * Always sets `nonce`. For tiers other than `normal`, also computes
   * `maxPriorityFeePerGas` and `maxFeePerGas` by scaling the node's
   * `getFeeData()` estimate. `normal` leaves the gas fields unset so
   * ethers' default path (which itself queries `getFeeData()`) flows
   * through — preserves the pre-tier behavior exactly.
   *
   * Non-EIP-1559 chains (no `maxPriorityFeePerGas` in feeData) fall back
   * to the bare `{ nonce }` overrides — same as ethers' default would do.
   */
  protected async buildTxOverrides(nonce: number): Promise<PayableOverrides> {
    if (this.gasTier === 'normal') {
      return { nonce };
    }
    const feeData = await this.provider.getFeeData();
    if (feeData.maxPriorityFeePerGas == null || feeData.maxFeePerGas == null) {
      // Pre-EIP-1559 chain (legacy gas only). Tier has no meaning here.
      return { nonce };
    }
    const basisPoints = BigInt(GAS_TIER_MULTIPLIER_BASIS_POINTS[this.gasTier]);
    const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * basisPoints) / 1000n;
    const maxFeePerGas = (feeData.maxFeePerGas * basisPoints) / 1000n;
    return { nonce, maxPriorityFeePerGas, maxFeePerGas };
  }
}
