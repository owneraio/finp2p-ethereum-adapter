import { ContractFactory, Provider, Signer } from "ethers";
import EXECUTION_CONTEXT_MANAGER
  from "../../artifacts/contracts/utils/finp2p/ExecutionContextManager.sol/ExecutionContextManager.json";
import FINP2P from "../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import { ExecutionContextManager, FINP2POperatorERC20 } from "../../typechain-types";
import {
  assetTypeFromNumber,
  completedOperation,
  failedOperation,
  FinP2PReceipt, LockInfo,
  OperationStatus,
  pendingOperation, ExecutionContext, AssetType, InstructionType, InstructionExecutor, Domain
} from "./model";
import { parseTransactionReceipt } from "./utils";
import { ContractsManager } from "./manager";
import { EIP712Domain, EIP712LoanTerms, EIP712Term } from "./eip712";
import winston from "winston";
import { FINP2POperatorERC20Interface } from "../../typechain-types/contracts/token/ERC20/FINP2POperatorERC20";
import { PayableOverrides } from "../../typechain-types/common";


const ETH_COMPLETED_TRANSACTION_STATUS = 1;

export class FinP2PContract extends ContractsManager {

  contractInterface: FINP2POperatorERC20Interface;

  executionManager: ExecutionContextManager;
  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  static async create(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: winston.Logger) {
    const exCtxManagerAddress =''; // TODO: get exCtxManagerAddress from finP2PContract
    return new FinP2PContract(provider, signer, exCtxManagerAddress, finP2PContractAddress, logger);
  }

  constructor(provider: Provider, signer: Signer, exCtxManagerAddress: string, finP2PContractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const executionManagerFactory = new ContractFactory<any[], ExecutionContextManager>(
      EXECUTION_CONTEXT_MANAGER.abi, EXECUTION_CONTEXT_MANAGER.bytecode, this.signer
    );
    this.executionManager = executionManagerFactory.attach(exCtxManagerAddress) as ExecutionContextManager;
    const finp2pFactory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const finP2PContract = finp2pFactory.attach(finP2PContractAddress);
    this.contractInterface = finP2PContract.interface as FINP2POperatorERC20Interface;
    this.finP2P = finP2PContract as FINP2POperatorERC20;
    this.finP2PContractAddress = finP2PContractAddress;
  }

  async eip712Domain(): Promise<EIP712Domain> {
    const domain = await this.executionManager.eip712Domain();
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

  async createExecutionPlan(planId: string) {
    return this.safeExecuteTransaction(this.executionManager, async (executionManager: ExecutionContextManager, txParams: PayableOverrides) => {
      return executionManager.createExecutionPlan(planId, this.finP2PContractAddress, txParams);
    });
  }

  async addInstructionToExecution(exCtx: ExecutionContext, instructionType: InstructionType, assetId: string, assetType: AssetType,
                                  source: string, destination: string, amount: string, instructionExecutor: InstructionExecutor, proofSigner: string) {
    return this.safeExecuteTransaction(this.executionManager, async (executionManager: ExecutionContextManager, txParams: PayableOverrides) => {
      return executionManager.addInstructionToExecution(exCtx, instructionType, assetId, assetType,
        source, destination, amount, instructionExecutor, proofSigner, txParams);
    });
  }

  async provideInvestorSignature(exCtx: ExecutionContext, domain: Domain, nonce: string, buyer: string, seller: string,
                                 asset: EIP712Term, settlement: EIP712Term, loan: EIP712LoanTerms, signature: string) {
    return this.safeExecuteTransaction(this.executionManager, async (executionManager: ExecutionContextManager, txParams: PayableOverrides) => {
      return executionManager.provideInvestorSignature(exCtx, domain, nonce, buyer, seller, asset, settlement, loan, signature, txParams);
    });
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, txParams);
    });
  }

  async issue(issuerFinId: string, assetId: string, assetType: AssetType, amount: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.issue(issuerFinId, assetId, assetType, amount, txParams);
    });
  }

  async redeem(ownerFinId: string, assetId: string, assetType: AssetType, amount: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.redeem(ownerFinId, assetId, assetType, amount, txParams);
    });
  }

  async issueWithContext(issuerFinId: string, assetId: string, assetType: AssetType, amount: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.issueWithContext(issuerFinId, assetId, assetType, amount, exCtx, txParams);
    });
  }

  async transferWithContext(source: string, destination: string, assetId: string, assetType: AssetType,
                            amount: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.transferWithContext(
        source, destination, assetId, assetType, amount, exCtx, txParams);
    });
  }

  async redeemWithContext(owner: string, assetId: string, assetType: AssetType,
                          amount: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.redeemWithContext(owner, assetId, assetType, amount, exCtx, txParams);
    });
  }

  async holdWithContext(source: string, destination: string, assetId: string, assetType: AssetType,
                        amount: string, operationId: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.holdWithContext(source, destination, assetId, assetType, amount, operationId, exCtx, txParams);
    });
  }

  async releaseToWithContext(source: string, destination: string, assetId: string, assetType: AssetType,
                             amount: string, operationId: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseToWithContext(source, destination, assetId, assetType, amount, operationId, exCtx, txParams);
    });
  }

  async releaseAndRedeemWithContext(source: string, assetId: string, assetType: AssetType,
                                    amount: string, operationId: string, exCtx: ExecutionContext) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseAndRedeemWithContext(source, assetId, assetType, amount, operationId, exCtx, txParams);
    });
  }

  async releaseBack(operationId: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseBack(operationId, txParams);
    });
  }

  async balance(assetId: string, finId: string) {
    return this.finP2P.getBalance(assetId, finId);
  }

  async hasRole(role: string, address: string) {
    return this.finP2P.hasRole(role, address);
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      return pendingOperation();
    } else {
      if (txReceipt?.status === ETH_COMPLETED_TRANSACTION_STATUS) {
        const block = await this.provider.getBlock(txReceipt.blockNumber);
        const timestamp = block?.timestamp || 0;
        const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
        if (receipt === null) {
          this.logger.error("Failed to parse receipt");
          return failedOperation("Failed to parse receipt", 1);
        }
        // const erc20Transfer = parseERC20Transfer(txReceipt, );
        // this.logger.info('ERC20 transfer event', erc20Transfer);
        return completedOperation(receipt);
      } else {
        return failedOperation(`Transaction failed with status: ${txReceipt.status}`, 1);
      }
    }
  }

  async getReceipt(hash: string): Promise<FinP2PReceipt> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      throw new Error("Transaction not found");
    }
    const block = await this.provider.getBlock(txReceipt.blockNumber);
    const timestamp = block?.timestamp || 0;
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
    if (receipt === null) {
      throw new Error("Failed to parse receipt");
    }
    return receipt;
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
      assetType: assetTypeFromNumber(info[1]),
      source: info[2],
      destination: info[3],
      amount: info[4]
    };
  }

}
