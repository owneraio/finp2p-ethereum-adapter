import {
  ContractFactory,
  Provider,
  Signer,
} from "ethers";
import FINP2P
  from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import { FINP2POperatorERC20 } from "../../typechain-types";
import {
  completedOperation,
  EIP712Domain,
  failedOperation,
  FinP2PReceipt,
  OperationStatus, pendingOperation
} from "./model";
import { hashToBytes16, parseTransactionReceipt } from "./utils";
import { ContractsManager } from './manager';
import { Leg, PrimaryType, Term } from "./eip712";
import winston from "winston";
import { FINP2POperatorERC20Interface } from "../../typechain-types/contracts/token/ERC20/FINP2POperatorERC20";
import { PayableOverrides } from "../../typechain-types/common";



const ETH_COMPLETED_TRANSACTION_STATUS = 1;

export class FinP2PContract extends ContractsManager {

  contractInterface: FINP2POperatorERC20Interface;

  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  constructor(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    this.contractInterface = contract.interface as FINP2POperatorERC20Interface;
    this.finP2P = contract as FINP2POperatorERC20;
    this.finP2PContractAddress = finP2PContractAddress;

  }

  async eip712Domain(): Promise<EIP712Domain> {
    const domain = await this.finP2P.eip712Domain();
    if (domain === null) {
      throw new Error('Failed to get EIP712 domain');
    }
    if (domain.length < 5) {
      throw new Error('Invalid EIP712 domain');
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

  async issue(issuerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.issue(issuerFinId, asset, txParams);
    });
  }

  async transfer(nonce: string, sellerFinId: string, buyerFinId: string,
                 asset: Term, settlement: Term, leg: Leg, eip712PrimaryType: PrimaryType, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.transfer(
        nonce, sellerFinId, buyerFinId, asset, settlement, leg, eip712PrimaryType, `0x${signature}`, txParams);
    });
  }

  async redeem(ownerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.redeem(ownerFinId, asset, txParams);
    });
  }

  async hold(operationId: string, nonce: string, sellerFinId: string, buyerFinId: string,
                   asset: Term, settlement: Term, leg: Leg, eip712PrimaryType: PrimaryType, signature: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.hold(hashToBytes16(operationId), nonce, sellerFinId, buyerFinId, asset, settlement, leg, eip712PrimaryType, `0x${signature}`, txParams);
    });
  }

  async releaseTo(operationId: string, buyerFinId: string, quantity: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseTo(hashToBytes16(operationId), buyerFinId, quantity, txParams);
    });
  }

  async releaseAndRedeem(operationId: string, ownerFinId: string, quantity: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseAndRedeem(hashToBytes16(operationId), ownerFinId, quantity, txParams);
    });
  }

  async releaseBack(operationId: string) {
    return this.safeExecuteTransaction(this.finP2P, async (finP2P: FINP2POperatorERC20, txParams: PayableOverrides) => {
      return finP2P.releaseBack(hashToBytes16(operationId), txParams);
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
        const block = await this.provider.getBlock(txReceipt.blockNumber)
        const timestamp = block?.timestamp || 0;
        const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
        if (receipt === null) {
          this.logger.error('Failed to parse receipt');
          return failedOperation('Failed to parse receipt', 1);
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
      throw new Error('Transaction not found');
    }
    const block = await this.provider.getBlock(txReceipt.blockNumber)
    const timestamp = block?.timestamp || 0;
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
    if (receipt === null) {
      throw new Error('Failed to parse receipt');
    }
    return receipt;
  }


}
