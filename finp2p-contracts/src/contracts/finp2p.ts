import { ContractFactory, ethers, Interface } from 'ethers';
import FINP2P
  from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import { FINP2POperatorERC20 } from '../../typechain-types';
import { FinP2PReceipt, OperationStatus } from './model';
import { parseTransactionReceipt, stringToByte16 } from './utils';
import { ContractsManager } from './manager';
import { FinP2PContractConfig } from './config';
import console from 'console';

export class FinP2PContract extends ContractsManager {

  contractInterface: Interface;

  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  constructor(config: FinP2PContractConfig) {
    super(config);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(config.finP2PContractAddress);
    this.contractInterface = contract.interface;
    this.finP2P = contract as FINP2POperatorERC20;
    this.finP2PContractAddress = config.finP2PContractAddress;
    this.signer.getNonce().then((nonce) => {
      console.log('Syncing nonce:', nonce);
    });
  }

  async getAssetAddress(assetId: string) {
    return this.finP2P.getAssetAddress(assetId);
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.associateAsset(assetId, tokenAddress);
    });
  }

  async issue(assetId: string, issuerFinId: string, quantity: number) {
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.issue(assetId, issuerFinId, quantity);
    });
  }

  async transfer(nonce: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    console.log('transfer', nonce, assetId, sourceFinId, destinationFinId, quantity, settlementHash, hash, signature);
    let encSettlementHash: string;
    if (settlementHash.length === 0) {
      encSettlementHash = ethers.encodeBytes32String('');
    } else {
      encSettlementHash = `0x${settlementHash}`;
    }
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.transfer(
        `0x${nonce}`, assetId, sourceFinId, destinationFinId, quantity,
        encSettlementHash, `0x${hash}`, `0x${signature}`);
    });
  }


  async redeem(nonce: string, assetId: string, finId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.redeem(`0x${nonce}`, assetId, finId, quantity,
        `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
    });
  }

  async hold(operationId: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number, expiry: number,
    assetHash: string, hash: string, signature: string) {
    let opId = stringToByte16(operationId);
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.hold(opId, assetId, sourceFinId, destinationFinId, quantity, expiry,
        `0x${assetHash}`, `0x${hash}`, `0x${signature}`);
    });
  }

  async release(operationId: string, destinationFinId: string) {
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.release(stringToByte16(operationId), destinationFinId);
    });
  }

  async rollback(operationId: string) {
    return this.safeExecuteTransaction(async () => {
      return this.finP2P.rollback(stringToByte16(operationId));
    });
  }

  async balance(assetId: string, finId: string) {
    return this.finP2P.getBalance(assetId, finId);
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      return {
        status: 'pending',
      };
    } else if (txReceipt?.status === 1) {
      let receipt = parseTransactionReceipt(txReceipt, this.contractInterface);
      if (receipt === null) {
        console.log('Failed to parse receipt');
        return {
          status: 'failed',
          error: {
            code: 1,
            message: 'Operation failed',
          },
        };
      }
      return {
        status: 'completed',
        receipt: receipt,
      };
    } else {
      return {
        status: 'failed',
        error: {
          code: 1,
          message: 'Operation failed',
        },
      };
    }
  }

  async getReceipt(hash: string): Promise<FinP2PReceipt> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      throw new Error('Transaction not found');
    }
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface);
    if (receipt === null) {
      throw new Error('Failed to parse receipt');
    }
    return receipt;
  }

}
