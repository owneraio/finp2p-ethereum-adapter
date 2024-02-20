import { ethers, JsonRpcProvider, Wallet, TransactionReceipt } from "ethers";
import Finp2pERC20 from "../../artifacts/contracts/token/ERC20/utils/Finp2pERC20.sol/Finp2pERC20.json";
import { IFinP2PAsset, IFinP2PEscrow } from "../../typechain-types";

export type OperationStatus = PendingTransaction | SuccessfulTransaction | FailedTransaction;


export type PendingTransaction = {
  status: "pending"
}

export type SuccessfulTransaction = {
  status: "completed"
  receipt: FinP2PReceipt
}

export type FinP2PReceipt = {
  id: string
  assetId: string
  amount: number
  source: string
  destination: string,
  timestamp: number
}

export type FailedTransaction = {
  status: "failed"
  error: TransactionError
}

export type TransactionError = {
  code: number
  message: string
}

export class FinP2PContract {

  provider: JsonRpcProvider;
  wallet: Wallet;
  asset: IFinP2PAsset;
  escrow: IFinP2PEscrow;

  constructor(rpcURL: string, privateKey: string, finP2PContractAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcURL);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    let genericContract = new ethers.Contract(
      finP2PContractAddress,
      Finp2pERC20.abi,
      this.wallet.connect(this.provider));
    this.asset = genericContract as unknown as IFinP2PAsset;
    this.escrow = genericContract as unknown as IFinP2PEscrow;
  }

  async balance(assetId: string, finId: string) {
    return await this.asset.getBalance(assetId, finId);
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt === null) {
      return {
        status: "pending"
      };
    } else if (receipt?.status === 1) {
      return {
        status: "completed",
        receipt: parseTransactionReceipt(receipt)
      };
    } else {
      return {
        status: "failed",
        error: {
          code: 1,
          message: "Operation failed"
        }
      };
    }
  }

  async getReceipt(hash: string): Promise<FinP2PReceipt> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (receipt?.status === 1) {
      return {} as FinP2PReceipt;
    }
    throw new Error("Transaction failed");
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

}

const parseTransactionReceipt = (receipt: TransactionReceipt): FinP2PReceipt => {
  return {
    id: "",
    assetId: "",
    amount: 0,
    source: "",
    destination: "",
    timestamp: 0
  };
};