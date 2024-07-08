import { ContractFactory, Interface } from 'ethers';
import FINP2P
  from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import { FINP2POperatorERC20 } from '../../typechain-types';
import { detectError, EthereumTransactionError, FinP2PReceipt, NonceToHighError, OperationStatus } from './model';
import { parseTransactionReceipt, stringToByte16 } from './utils';
import { ContractsManager } from './manager';
import { FinP2PContractConfig } from './config';

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
  }

  async getAssetAddress(assetId: string) {
    return this.finP2P.getAssetAddress(assetId);
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    const response = await this.finP2P.associateAsset(assetId, tokenAddress);
    return response.hash;
  }

  async issue(assetId: string, issuerFinId: string, quantity: number) {
    try {
      const response = await this.finP2P.issue(assetId, issuerFinId, quantity);
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
  }

  async transfer(nonce: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    try {
      const response = await this.finP2P.transfer(
        `0x${nonce}`, assetId, sourceFinId, destinationFinId, quantity,
        `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
  }

  async redeem(nonce: string, assetId: string, finId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    try {
      const response = await this.finP2P.redeem(`0x${nonce}`, assetId, finId, quantity,
        `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
  }

  async hold(operationId: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number, expiry: number,
    assetHash: string, hash: string, signature: string) {
    let opId = stringToByte16(operationId);
    try {
      const response = await this.finP2P.hold(opId, assetId, sourceFinId, destinationFinId, quantity, expiry,
        `0x${assetHash}`, `0x${hash}`, `0x${signature}`);
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
  }

  async release(operationId: string, destinationFinId: string) {
    try {
      const response = await this.finP2P.release(stringToByte16(operationId), destinationFinId);
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
  }

  async rollback(operationId: string) {
    try {
      const response = await this.finP2P.rollback(stringToByte16(operationId));
      return response.hash;
    } catch (e) {
      this.processFailure(e);
    }
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

  processFailure(e: any) {
    const err = detectError(e);
    if (err instanceof EthereumTransactionError) {
      console.log('Ethereum transaction error');
      this.resetNonce();
    } else  if (err instanceof NonceToHighError) {
      console.log('Nonce too high error');
      this.resetNonce();
    }
    throw err;
  }
}
