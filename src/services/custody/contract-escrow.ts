import winston from "winston";
import { ZeroAddress } from "ethers";
import { TokenOperationResult } from "@owneraio/finp2p-ethereum-adapter-contract";
import { EscrowContract, EscrowHoldStatus } from "@owneraio/finp2p-ethereum-orchestrator";
import { Erc20Contract } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { CustodyWallet } from "./custody-provider";

/** What the caller believes the hold is; checked against on-chain state before terminal ops. */
export type ExpectedHold = {
  token: string;
  amount: bigint;
  source?: string;
};

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
      const erc20 = new Erc20Contract(sourceWallet.signer, tokenAddress);
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

  async release(operationId: string, toAddress: string, expected: ExpectedHold): Promise<TokenOperationResult> {
    try {
      const mismatch = await this.holdMismatch(operationId, expected);
      if (mismatch) return { status: "failure", reason: mismatch };
      const receipt = await this.escrowContract.release(operationId, toAddress);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  async rollback(operationId: string, expected: ExpectedHold): Promise<TokenOperationResult> {
    try {
      const mismatch = await this.holdMismatch(operationId, expected);
      if (mismatch) return { status: "failure", reason: mismatch };
      const receipt = await this.escrowContract.rollback(operationId);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  async releaseAndBurn(operationId: string, expected: ExpectedHold): Promise<TokenOperationResult> {
    try {
      const mismatch = await this.holdMismatch(operationId, expected);
      if (mismatch) return { status: "failure", reason: mismatch };
      const receipt = await this.escrowContract.releaseAndBurn(operationId);
      return await this.toResult(receipt.hash, receipt.blockNumber);
    } catch (e) {
      return { status: "failure", reason: `${e}` };
    }
  }

  /**
   * The escrow contract moves the STORED hold (token + full amount), while the
   * adapter's receipt reports the request's asset/quantity. Refuse to execute
   * when the two disagree, so receipts can never claim a different movement
   * than what happened on-chain.
   */
  private async holdMismatch(operationId: string, expected: ExpectedHold): Promise<string | undefined> {
    let hold;
    try {
      hold = await this.escrowContract.getHold(operationId);
    } catch (e) {
      return `Hold ${operationId} not found: ${e}`;
    }
    if (hold.status !== EscrowHoldStatus.Held) {
      return `Hold ${operationId} is not active (status ${hold.status})`;
    }
    if (hold.token.toLowerCase() !== expected.token.toLowerCase()) {
      return `Hold ${operationId} is for token ${hold.token}, not ${expected.token}`;
    }
    if (hold.amount !== expected.amount) {
      return `Hold ${operationId} is for ${hold.amount} token units, not ${expected.amount}`;
    }
    if (expected.source && hold.source.toLowerCase() !== expected.source.toLowerCase()) {
      return `Hold ${operationId} source is ${hold.source}, not ${expected.source}`;
    }
    return undefined;
  }

  private async toResult(transactionId: string, blockNumber: number): Promise<TokenOperationResult> {
    const block = await this.escrowContract.provider.getBlock(blockNumber);
    return { status: "success", transactionId, timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000) };
  }
}
