import { ContractFactory, ContractTransactionResponse, Interface, Provider, Signer, TransactionReceipt } from "ethers";
import { Logger } from "./adapter-types";
import FINP2P from "../artifacts/contracts/finp2p/FINP2POperator.sol/FINP2POperator.json";
import { FINP2POperator } from "../typechain-types";
import { FINP2POperatorInterface } from "../typechain-types/contracts/finp2p/FINP2POperator";
import { PayableOverrides } from "../typechain-types/common";
import {
  LockInfo, OperationParams,
  Term
} from "./model";
import { parseTransactionReceipt } from "./utils";
import { ContractsManager } from "./manager";
import {
  EIP712Domain, EIP712LoanTerms, PrimaryType, ReceiptOperation,
  failedReceiptOperation, pendingReceiptOperation,
  successfulReceiptOperation
} from "./adapter-types";
import { assetTypeToService } from "./mappers";


const ETH_COMPLETED_TRANSACTION_STATUS = 1;

export enum FinP2PVariant {
  Basic = 'basic',
  WithRegistry = 'with-registry',
}

/**
 * 3-arg `associateAsset` call data for `FINP2POperatorWithRegistry`. The basic
 * variant only has the 2-arg form (typed via typechain). For the 3-arg form we
 * encode the call manually so we don't need to drag in a second contract type.
 */
const WITH_REGISTRY_IFACE = new Interface([
  "function associateAsset(string assetId, address tokenAddress, bytes32 assetStandard)",
]);

export class FinP2PContract extends ContractsManager {

  contractInterface: FINP2POperatorInterface;

  finP2P: FINP2POperator;

  finP2PContractAddress: string;

  variant: FinP2PVariant;

  constructor(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: Logger, variant: FinP2PVariant = FinP2PVariant.Basic) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], FINP2POperator>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    this.contractInterface = contract.interface as FINP2POperatorInterface;
    this.finP2P = contract as FINP2POperator;
    this.finP2PContractAddress = finP2PContractAddress;
    this.variant = variant;
  }

  /**
   * Async factory: constructs a FinP2PContract and probes the deployed variant
   * via `hasAssetRegistry()`. Preferred over `new FinP2PContract(...)` whenever
   * the adapter doesn't know up-front which variant it's talking to.
   */
  static async create(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: Logger): Promise<FinP2PContract> {
    const c = new FinP2PContract(provider, signer, finP2PContractAddress, logger);
    c.variant = (await c.hasAssetRegistry()) ? FinP2PVariant.WithRegistry : FinP2PVariant.Basic;
    logger.info(`FinP2PContract variant detected: ${c.variant} at ${finP2PContractAddress}`);
    return c;
  }

  async getVersion() {
    return this.mapErrors(async () => this.finP2P.getVersion())
  }

  /**
   * True iff the deployed contract is `FINP2POperatorWithRegistry` (rather than
   * the basic `FINP2POperator`). The two variants share the same name and
   * VERSION constant but the WithRegistry variant exposes a unique
   * `getAssetRegistry() returns (address)` method — probe for it via a raw
   * eth_call. Function-missing reverts → basic operator. Transport failures
   * (RPC down, network timeout, unauthenticated, etc.) re-throw so we don't
   * silently misclassify a WithRegistry deployment during a startup blip.
   */
  async hasAssetRegistry(): Promise<boolean> {
    const probe = new Interface(["function getAssetRegistry() view returns (address)"]);
    try {
      const result = await this.provider.call({
        to: this.finP2PContractAddress,
        data: probe.encodeFunctionData("getAssetRegistry", []),
      });
      probe.decodeFunctionResult("getAssetRegistry", result);
      return true;
    } catch (e) {
      if (isFunctionMissingError(e)) return false;
      throw e;
    }
  }

  async eip712Domain(): Promise<EIP712Domain> {
    const domain = await this.finP2P.eip712Domain();
    if (domain === null) {
      throw new Error("Failed to get EIP712 domain");
    }
    if (domain.length < 5) {
      throw new Error("Invalid EIP712 domain");
    }
    const name = domain[1];
    const version = domain[2];
    const chainId = parseInt(`${domain[3]}`);
    const verifyingContract = domain[4];
    return { name, version, chainId, verifyingContract };
  }

  async getAssetAddress(assetId: string) {
    return this.finP2P.getAssetAddress(assetId);
  }

  async associateAsset(assetId: string, tokenAddress: string, assetStandard?: string) {
    if (this.variant === FinP2PVariant.WithRegistry) {
      if (!assetStandard) {
        throw new Error(`FINP2POperatorWithRegistry.associateAsset requires a bytes32 assetStandard at ${this.finP2PContractAddress}`);
      }
      const data = WITH_REGISTRY_IFACE.encodeFunctionData("associateAsset", [assetId, tokenAddress, assetStandard]);
      return this.safeExecuteTransaction(this.finP2P, async (_: FINP2POperator, txParams: PayableOverrides) => {
        // signer.sendTransaction returns TransactionResponse; safeExecuteTransaction wants
        // ContractTransactionResponse — same wire object, the extra surface is unused here.
        return this.signer.sendTransaction({ to: this.finP2PContractAddress, data, ...txParams }) as unknown as Promise<ContractTransactionResponse>;
      });
    }
    if (assetStandard) {
      this.logger.warning(`assetStandard supplied to associateAsset but contract variant is 'basic' — ignored`);
    }
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, txParams);
    });
  }

  async addCredential(finId: string, address: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.addCredential(finId, address, txParams);
    });
  }

  async removeCredential(finId: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.removeCredential(finId, txParams);
    });
  }

  async getCredentialAddress(finId: string) {
    return this.finP2P.getCredentialAddress(finId);
  }

  async setEscrowWalletAddress(escrowAccountAddress: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.setEscrowWalletAddress(escrowAccountAddress, txParams);
    });
  }

  async issue(issuerFinId: string, asset: Term, params: OperationParams) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.issue(issuerFinId, asset, params, txParams);
    });
  }

  async transfer(nonce: string, fromFinId: string, toFinId: string,
                 asset: Term, settlement: Term, loan: EIP712LoanTerms, params: OperationParams, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.transfer(
        nonce, fromFinId, toFinId, asset, settlement, loan, params, `0x${signature}`, txParams);
    });
  }

  async redeem(ownerFinId: string, asset: Term, params: OperationParams) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.redeem(ownerFinId, asset, params, txParams);
    });
  }

  async hold(nonce: string, fromFinId: string, toFinId: string,
             asset: Term, settlement: Term, loan: EIP712LoanTerms, params: OperationParams, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.hold(nonce, fromFinId, toFinId, asset, settlement, loan, params, `0x${signature}`, txParams);
    });
  }

  async releaseTo(operationId: string, fromFinId: string, toFinId: string, quantity: string, params: OperationParams) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.releaseTo(operationId, fromFinId, toFinId, quantity, params, txParams);
    });
  }

  async releaseAndRedeem(operationId: string, ownerFinId: string, quantity: string, params: OperationParams) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.releaseAndRedeem(operationId, ownerFinId, quantity, params, txParams);
    });
  }

  async releaseBack(operationId: string, params: OperationParams) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperator, txParams: PayableOverrides) => {
      return finP2P.releaseBack(operationId, params, txParams);
    });
  }

  async balance(assetId: string, finId: string) {
    return this.finP2P.getBalance(assetId, finId);
  }

  async hasRole(role: string, address: string) {
    return this.finP2P.hasRole(role, address);
  }

  async verifyInvestmentSignature(primaryType: PrimaryType, nonce: string, buyerFinId: string, sellerFinId: string,
                                  asset: Term, settlement: Term, loan: EIP712LoanTerms, signerFinId: string, signature: string
  ) {
    return await this.finP2P.verifyInvestmentSignature(
      primaryType, nonce, buyerFinId, sellerFinId, asset, settlement, loan, signerFinId, `0x${signature}`
    );
  }

  async hashInvestment(primaryType: PrimaryType, nonce: string, buyerFinId: string, sellerFinId: string,
                       asset: Term, settlement: Term, loan: EIP712LoanTerms
  ) {
    return await this.finP2P.hashInvestment(
      primaryType, `0x${nonce}`, buyerFinId, sellerFinId, asset, settlement, loan
    );
  }

  async getOperationStatus(txHash: string): Promise<ReceiptOperation> {
    const txReceipt = await this.provider.getTransactionReceipt(txHash);
    if (txReceipt === null) {
      return pendingReceiptOperation(txHash, undefined);
    } else {
      if (txReceipt?.status === ETH_COMPLETED_TRANSACTION_STATUS) {
        const block = await this.provider.getBlock(txReceipt.blockNumber);
        const timestamp = block?.timestamp || 0;
        const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
        const indexationWaitTime = 60 * 60 // 1 hour
        if (receipt === null) {
          this.logger.warning("Failed to parse receipt");
          return pendingReceiptOperation(txHash, undefined)
        }
        // const erc20Transfer = parseERC20Transfer(txReceipt, );
        // this.logger.info('ERC20 transfer event', erc20Transfer);
        return successfulReceiptOperation(receipt);
      } else {
        return failedReceiptOperation(1, `Transaction failed with status: ${txReceipt.status}`);
      }
    }
  }

  async getReceiptFromTransactionReceipt(txReceipt: TransactionReceipt): Promise<ReceiptOperation> {
    const block = await this.provider.getBlock(txReceipt.blockNumber);
    const timestamp = block?.timestamp || 0;
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
    if (receipt === null) {
      throw new Error("Failed to parse receipt");
    }
    return successfulReceiptOperation(receipt);
  }

  async getReceipt(hash: string): Promise<ReceiptOperation> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      throw new Error("Transaction not found");
    }

    return this.getReceiptFromTransactionReceipt(txReceipt)
  }

  async getLockInfo(operationId: string): Promise<LockInfo> {
    const info = await this.finP2P.getLockInfo(operationId);
    if (info === null) {
      throw new Error("Failed to get lock info");
    }
    if (info.length < 4) {
      throw new Error("Failed to get lock info");
    }
    return {
      assetId: info[0],
      assetType: assetTypeToService(info[1]),
      source: info[2],
      destination: info[3],
      amount: info[4]
    };
  }

}

/**
 * Distinguish "function doesn't exist on the deployed contract" (the signal we
 * want from a probe) from real transport failures (RPC down, timeout, network
 * unauthenticated, etc.) that should propagate instead of being swallowed as
 * "function missing → variant is basic".
 *
 * Real RPC nodes surface a missing function as ethers v6 CALL_EXCEPTION with
 * empty (`0x`) return data. Hardhat-EDR (in-process devnode) instead throws
 * with the literal message "function selector was not recognized". Match both;
 * everything else (NETWORK_ERROR, TIMEOUT, UNCONFIGURED_NAME, auth, …) re-throws.
 */
export function isFunctionMissingError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { code?: string; data?: string; message?: string };
  if (err.code === 'CALL_EXCEPTION' && (err.data === '0x' || err.data === undefined || err.data === null)) {
    return true;
  }
  if (typeof err.message === 'string' && /function selector was not recognized/i.test(err.message)) {
    return true;
  }
  return false;
}
