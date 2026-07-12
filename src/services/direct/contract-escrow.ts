import winston from "winston";
import { ZeroAddress } from "ethers";
import { TokenOperationResult } from "@owneraio/finp2p-ethereum-token-standard";
import { ERC20Contract, EscrowContract } from "@owneraio/finp2p-contracts";
import { CustodyWallet } from "./custody-provider";

/**
 * Direct-mode escrow backed by the standalone FinP2PEscrow contract instead of
 * a custody escrow wallet. Deposits are signed by the investor's own custody
 * wallet (ERC20 approve + deposit); release/rollback/burn are signed by the
 * adapter's escrow-operator wallet, which holds the contract's ESCROW_OPERATOR
 * role. The contract enforces single-use holds and destination pinning that a
 * plain wallet cannot.
 */
export class ContractEscrow {

  constructor(
    // bound to the escrow-operator wallet's signer
    private readonly escrowContract: EscrowContract,
    private readonly logger: winston.Logger
  ) {}

  get escrowAddress(): string {
    return this.escrowContract.escrowContractAddress;
  }

  async hold(
    sourceWallet: CustodyWallet, sourceAddress: string, destinationAddress: string | undefined,
    tokenAddress: string, operationId: string, amount: bigint
  ): Promise<TokenOperationResult> {
    try {
      const erc20 = new ERC20Contract(sourceWallet.provider, sourceWallet.signer, tokenAddress, this.logger as any);
      const allowance = await erc20.allowance(sourceAddress, this.escrowAddress);
      if (allowance < amount) {
        this.logger.info(`ContractEscrow: approving ${amount} of ${tokenAddress} for escrow ${this.escrowAddress}`);
        const approveTx = await erc20.approve(this.escrowAddress, amount);
        await approveTx.wait();
      }
      const receipt = await this.escrowContract
        .withSigner(sourceWallet.signer)
        .deposit(operationId, tokenAddress, sourceAddress, destinationAddress ?? ZeroAddress, amount);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  async release(operationId: string, toAddress: string): Promise<TokenOperationResult> {
    try {
      const receipt = await this.escrowContract.release(operationId, toAddress);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  async rollback(operationId: string): Promise<TokenOperationResult> {
    try {
      const receipt = await this.escrowContract.rollback(operationId);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  async releaseAndBurn(operationId: string): Promise<TokenOperationResult> {
    try {
      const receipt = await this.escrowContract.releaseAndBurn(operationId);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  private async toResult(transactionId: string, blockNumber: number): Promise<TokenOperationResult> {
    const block = await this.escrowContract.provider.getBlock(blockNumber);
    return { status: "success", transactionId, timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000) };
  }
}
