import { ContractFactory, ContractTransactionResponse, Interface, Provider, Signer } from "ethers";
import FINP2P
  from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import { FINP2POperatorERC20 } from '../../typechain-types';
import {
  detectError,
  EthereumTransactionError,
  FinP2PReceipt,
  NonceAlreadyBeenUsedError,
  NonceToHighError,
  OperationStatus
} from "./model";
import { parseTransactionReceipt } from './utils';
import { ContractsManager } from './manager';
import console from 'console';
import { HashType } from "./hash";

export class FinP2PContract extends ContractsManager {

  contractInterface: Interface;

  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  constructor(provider: Provider, signer: Signer, finP2PContractAddress: string) {
    super(provider, signer);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    this.contractInterface = contract.interface;
    this.finP2P = contract as FINP2POperatorERC20;
    this.finP2PContractAddress = finP2PContractAddress;
    this.signer.getNonce().then((nonce) => {
      console.log('Syncing nonce:', nonce);
    });
  }

  async eip712Domain() {
    return this.finP2P.eip712Domain();
  }

  async getAssetAddress(assetId: string) {
    return this.finP2P.getAssetAddress(assetId);
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.associateAsset(assetId, tokenAddress);
    });
  }

  async issueWithoutSignature(assetId: string, issuerFinId: string, quantity: number) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.issueWithoutSignature(assetId, issuerFinId, quantity);
    });
  }

  async issue(nonce: string, assetId: string, buyerFinId: string, issuerFinId: string, quantity: number,
    settlementAsset: string, settlementAmount: number, hashType: HashType, signature: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.issue(
        nonce, assetId, buyerFinId, issuerFinId, quantity,
        settlementAsset, settlementAmount, hashType, `0x${signature}`);
    });
  }

  async transfer(nonce: string, assetId: string, sellerFinId: string, buyerFinId: string, quantity: number,
    settlementAsset: string, settlementAmount: number, hashType: HashType, signature: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.transfer(
        nonce, assetId, sellerFinId, buyerFinId, quantity,
        settlementAsset, settlementAmount, hashType, `0x${signature}`);
    });
  }

  async redeem(nonce: string, assetId: string, ownerFinId: string, buyerFinId: string, quantity: number,
    settlementAsset: string, settlementAmount: number, hashType: HashType, signature: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.redeem(nonce, assetId, ownerFinId, buyerFinId, quantity,
        settlementAsset, settlementAmount, hashType, `0x${signature}`);
    });
  }

  async hold(operationId: string, nonce: string, assetId: string, sellerFinId: string, buyerFinId: string, quantity: number,
    settlementAsset: string, settlementAmount: number, /*hashType: HashType, */signature: string) {
    const opId = `0x${operationId.replaceAll('-', '')}`;
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.hold(opId, nonce, assetId, sellerFinId, buyerFinId, quantity,
        settlementAsset, settlementAmount, /*hashType,*/ `0x${signature}`);
    });
  }

  async release(operationId: string, sellerFinId: string) {
    const opId = `0x${operationId.replaceAll('-', '')}`;
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.release(opId, sellerFinId);
    });
  }

  async rollback(operationId: string) {
    const opId = `0x${operationId.replaceAll('-', '')}`;
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.rollback(opId);
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

  private async safeExecuteTransaction(call: (finp2p: FINP2POperatorERC20) => Promise<ContractTransactionResponse>, maxAttempts: number = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await call(this.finP2P);
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
}
