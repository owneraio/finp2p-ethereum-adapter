import { ContractFactory, Provider, Signer } from "ethers";
import ESCROW from "../artifacts/contracts/finp2p/v2/FinP2PEscrow.sol/FinP2PEscrow.json";
import { FinP2PEscrow } from "../typechain-types";
import { PayableOverrides } from "../typechain-types/common";
import { ContractsManager, GasTier } from "./manager";
import { Logger } from "./adapter-types";

export enum EscrowHoldStatus {
  None = 0,
  Held = 1,
  Released = 2,
  RolledBack = 3,
  Burned = 4
}

export type EscrowHold = {
  token: string;
  source: string;
  destination: string;
  amount: bigint;
  status: EscrowHoldStatus;
};

/**
 * Client for the standalone FinP2PEscrow contract. In operator (v2) mode the
 * plan operator drives the escrow on-chain and this client is only used for
 * setup/inspection; in direct mode the adapter drives it: investor custody
 * wallets deposit (via `withSigner`) and the escrow-operator wallet
 * releases/rolls back.
 */
export class EscrowContract extends ContractsManager {

  escrow: FinP2PEscrow;

  escrowContractAddress: string;

  constructor(provider: Provider, signer: Signer, escrowContractAddress: string, logger: Logger,
              confirmationTimeoutMs?: number, gasTier?: GasTier) {
    super(provider, signer, logger, confirmationTimeoutMs, gasTier);
    const factory = new ContractFactory<any[], FinP2PEscrow>(
      ESCROW.abi, ESCROW.bytecode, this.signer
    );
    this.escrow = factory.attach(escrowContractAddress) as FinP2PEscrow;
    this.escrowContractAddress = escrowContractAddress;
  }

  /** A new client bound to another signer (e.g. an investor custody wallet). */
  withSigner(signer: Signer): EscrowContract {
    return new EscrowContract(
      this.provider, signer, this.escrowContractAddress, this.logger, this.confirmationTimeoutMs, this.gasTier);
  }

  async grantEscrowOperatorRole(account: string) {
    return this.safeExecuteTransaction(this.escrow, async (escrow, txParams: PayableOverrides) => {
      return escrow.grantEscrowOperatorRole(account, txParams);
    });
  }

  async deposit(operationId: string, token: string, source: string, destination: string, amount: bigint) {
    return this.safeExecuteTransaction(this.escrow, async (escrow, txParams: PayableOverrides) => {
      return escrow.deposit(operationId, token, source, destination, amount, txParams);
    });
  }

  async release(operationId: string, to: string) {
    return this.safeExecuteTransaction(this.escrow, async (escrow, txParams: PayableOverrides) => {
      return escrow.release(operationId, to, txParams);
    });
  }

  async rollback(operationId: string) {
    return this.safeExecuteTransaction(this.escrow, async (escrow, txParams: PayableOverrides) => {
      return escrow.rollback(operationId, txParams);
    });
  }

  async releaseAndBurn(operationId: string) {
    return this.safeExecuteTransaction(this.escrow, async (escrow, txParams: PayableOverrides) => {
      return escrow.releaseAndBurn(operationId, txParams);
    });
  }

  async hasHold(operationId: string): Promise<boolean> {
    return this.escrow.hasHold(operationId);
  }

  async getHold(operationId: string): Promise<EscrowHold> {
    const hold = await this.escrow.getHold(operationId);
    return {
      token: hold.token,
      source: hold.source,
      destination: hold.destination,
      amount: hold.amount,
      status: Number(hold.status)
    };
  }
}
