import { ContractFactory, Provider, Signer } from "ethers";
import winston from "winston";
import FINP2P from "../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json";
import { FINP2POperatorERC20 } from "../typechain-types";
import { FINP2POperatorERC20Interface } from "../typechain-types/contracts/token/ERC20/FINP2POperatorERC20";
import { PayableOverrides } from "../typechain-types/common";
import {
  LockInfo, OperationParams,
  Term
} from "./model";
import { parseTransactionReceipt } from "./utils";
import { ContractsManager } from "./manager";
import { EIP712Domain, EIP712LoanTerms, PrimaryType, ReceiptOperation } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  failedReceiptOperation, pendingReceiptOperation,
  successfulReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/services/model";
import { assetTypeToService } from "./mappers";


const ETH_COMPLETED_TRANSACTION_STATUS = 1;

export class FinP2PContract extends ContractsManager {

  contractInterface: FINP2POperatorERC20Interface;

  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  constructor(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer
    );
    const contract = factory.attach(finP2PContractAddress);
    this.contractInterface = contract.interface as FINP2POperatorERC20Interface;
    this.finP2P = contract as FINP2POperatorERC20;
    this.finP2PContractAddress = finP2PContractAddress;
  }

  async getVersion() {
    return await this.finP2P.getVersion();
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

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.associateAsset(assetId, tokenAddress, txParams);
    });
  }

  async setEscrowWalletAddress(escrowAccountAddress: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.setEscrowWalletAddress(escrowAccountAddress, txParams);
    });
  }

  async issue(issuerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.issue(issuerFinId, asset, txParams);
    });
  }

  async transfer(nonce: string, sellerFinId: string, buyerFinId: string,
                 asset: Term, settlement: Term, loan: EIP712LoanTerms, params: OperationParams, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.transfer(
        nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, `0x${signature}`, txParams);
    });
  }

  async redeem(ownerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.redeem(ownerFinId, asset, txParams);
    });
  }

  async hold(nonce: string, sellerFinId: string, buyerFinId: string,
             asset: Term, settlement: Term, loan: EIP712LoanTerms, params: OperationParams, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, `0x${signature}`, txParams);
    });
  }

  async releaseTo(operationId: string, buyerFinId: string, quantity: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseTo(operationId, buyerFinId, quantity, txParams);
    });
  }

  async releaseAndRedeem(operationId: string, ownerFinId: string, quantity: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseAndRedeem(operationId, ownerFinId, quantity, txParams);
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
        if (receipt === null) {
          this.logger.error("Failed to parse receipt");
          return failedReceiptOperation(1, "Failed to parse receipt");
        }
        // const erc20Transfer = parseERC20Transfer(txReceipt, );
        // this.logger.info('ERC20 transfer event', erc20Transfer);
        return successfulReceiptOperation(receipt);
      } else {
        return failedReceiptOperation(1, `Transaction failed with status: ${txReceipt.status}`);
      }
    }
  }

  async getReceipt(hash: string): Promise<ReceiptOperation> {
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
    return successfulReceiptOperation(receipt);
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
