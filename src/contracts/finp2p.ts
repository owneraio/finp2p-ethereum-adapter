import { ethers, JsonRpcProvider, TransactionReceipt, Wallet } from 'ethers';
import Finp2pERC20 from '../../artifacts/contracts/token/ERC20/utils/Finp2pERC20.sol/Finp2pERC20.json';
import { IFinP2PAsset, IFinP2PEscrow } from '../../typechain-types';
import { FinP2PReceipt, OperationStatus } from './model';

export class FinP2PContract {

  provider: JsonRpcProvider;

  wallet: Wallet;

  genericContract: ethers.Contract;

  asset: IFinP2PAsset;

  escrow: IFinP2PEscrow;

  constructor(rpcURL: string, privateKey: string, finP2PContractAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcURL);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.genericContract = new ethers.Contract(
      finP2PContractAddress,
      Finp2pERC20.abi,
      this.wallet.connect(this.provider));
    this.asset = this.genericContract as unknown as IFinP2PAsset;
    this.escrow = this.genericContract as unknown as IFinP2PEscrow;
  }

  async issue(assetId: string, issuerFinId: string, quantity: number) {
    const response = await this.asset.issue(assetId, issuerFinId, quantity);
    return response.hash;
  }

  async transfer(nonce: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    const response = await this.asset.transfer(nonce, assetId, sourceFinId, destinationFinId, quantity,
      settlementHash, hash, signature);
    return response.hash;
  }

  async redeem(nonce: string, assetId: string, finId: string, quantity: number,
    settlementHash: string, hash: string, signature: string) {
    const response = await this.asset.redeem(nonce, assetId, finId, quantity,
      settlementHash, hash, signature);
    return response.hash;
  }

  async hold(operationId: string, assetId: string, sourceFinId: string, destinationFinId: string, quantity: number, expiry: number,
    assetHash: string, hash: string, signature: string) {
    const response = await this.escrow.hold(operationId, assetId, sourceFinId, destinationFinId, quantity, expiry,
      assetHash, hash, signature);
    return response.hash;
  }

  async release(operationId: string, destinationFinId: string) {
    const response = await this.escrow.release(operationId, destinationFinId);
    return response.hash;
  }

  async rollback(operationId: string) {
    const response = await this.escrow.rollback(operationId);
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


  async parseTransactionReceipt(receipt: TransactionReceipt): Promise<FinP2PReceipt> {
    // const id = receipt.hash;
    // const timestamp = 0;

    for (const log of receipt.logs) {
      const parsedLog = this.genericContract.interface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }
      // const args = parsedLog.args;
      console.log(parsedLog);
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
