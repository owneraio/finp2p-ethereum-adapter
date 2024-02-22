import { ethers, Wallet } from 'ethers';
import Finp2pERC20 from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import ERC20 from '../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json';
import { IFinP2PAsset, IFinP2PEscrow } from '../../typechain-types';
import { FinP2PReceipt, OperationStatus } from './model';
import console from 'console';

export class FinP2PContract {

  provider: ethers.providers.JsonRpcProvider;

  wallet: Wallet;

  genericContract: ethers.Contract;

  asset: IFinP2PAsset;

  escrow: IFinP2PEscrow;

  finP2PContractAddress: string;

  constructor(rpcURL: string, privateKey: string, finP2PContractAddress: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcURL);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.genericContract = new ethers.Contract(
      finP2PContractAddress,
      Finp2pERC20.abi,
      this.wallet.connect(this.provider));
    this.asset = this.genericContract as unknown as IFinP2PAsset;
    this.escrow = this.genericContract as unknown as IFinP2PEscrow;
    this.finP2PContractAddress = finP2PContractAddress;
  }

  async deployFinP2PContract() {
    console.log('Deploying FinP2P contract...');
    const factory = new ethers.ContractFactory(Finp2pERC20.abi, Finp2pERC20.bytecode, this.wallet);
    const contract = await factory.deploy();
    const address = contract.address;
    console.log('FinP2P contract deployed successfully at:', address);

    return address;
  }

  async deployERC20(name: string, symbol: string) {
    console.log('Deploying ERC20 contract...');
    const factory = new ethers.ContractFactory(ERC20.abi, ERC20.bytecode, this.wallet);
    const contract = await factory.deploy(name, symbol, this.finP2PContractAddress);
    const address = contract.address;
    console.log('ERC20 contract deployed successfully at:', address);

    return address;
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    const response = await this.asset.associateAsset(assetId, tokenAddress);
    return response.hash;
  }

  async issue(assetId: string, issuerFinId: string, quantity: number) {
    const response = await this.asset.issue(assetId, issuerFinId, quantity);
    return response.hash;
  }

  async transfer(nonce: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    const response = await this.asset.transfer(
      `0x${nonce}`, assetId, sourceFinId, destinationFinId, quantity,
      `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async redeem(nonce: string, assetId: string, finId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    const response = await this.asset.redeem(`0x${nonce}`, assetId, finId, quantity,
      `0x${settlementHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async hold(operationId: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number, expiry: number,
    assetHash: string, hash: string, signature: string) {
    const response = await this.escrow.hold(`0x${operationId}`, assetId, sourceFinId, destinationFinId, quantity, expiry,
      `0x${assetHash}`, `0x${hash}`, `0x${signature}`);
    return response.hash;
  }

  async release(operationId: string, destinationFinId: string) {
    const response = await this.escrow.release(`0x${operationId}`, destinationFinId);
    return response.hash;
  }

  async rollback(operationId: string) {
    const response = await this.escrow.rollback(`0x${operationId}`);
    return response.hash;
  }


  async balance(assetId: string, finId: string) {
    return this.asset.getBalance(assetId, finId);
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt === null) {
      return {
        status: 'pending',
      };
    } else if (receipt?.status === 1) {
      return {
        status: 'completed',
        receipt: await this.parseTransactionReceipt(receipt),
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
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt === null) {
      throw new Error('Transaction not found');
    }
    return this.parseTransactionReceipt(receipt);
  }

  async parseTransactionReceipt(receipt: any): Promise<FinP2PReceipt> {
    const id = receipt.transactionHash;
    const timestamp = 0;

    for (const log of receipt.logs) {
      try {
        const parsedLog = this.genericContract.interface.parseLog(log);
        switch (parsedLog.name) {
          case 'Issue':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              destination: parsedLog.args.issuerFinId,
              timestamp: timestamp,
            };
          case 'Transfer':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              source: parsedLog.args.sourceFinId,
              destination: parsedLog.args.destinationFinId,
              timestamp: timestamp,
            };
          case 'Redeem':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              source: parsedLog.args.issuerFinId,
              timestamp: timestamp,
            };
          case 'Hold':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              source: parsedLog.args.finId,
              timestamp: timestamp,
            };
          case 'Release':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              source: parsedLog.args.sourceFinId,
              destination: parsedLog.args.destinationFinId,
              timestamp: timestamp,
            };
          case 'Rollback':
            return {
              id: id,
              assetId: parsedLog.args.assetId,
              amount: parsedLog.args.quantity.toNumber(),
              destination: parsedLog.args.destinationFinId,
              timestamp: timestamp,
            };
        }
      } catch (e) {
        // do nothing
      }
    }

    return {
      id: '',
      assetId: '',
      amount: 0,
      source: '',
      destination: '',
      timestamp: 0,
    };
  }

}
