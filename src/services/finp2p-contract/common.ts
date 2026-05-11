import {
  CommonService, HealthService, OperationStatus,
  ProofProvider, PluginManager,
  ReceiptOperation, ExecutionContext,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { mapReceiptOperation } from "./mapping";


export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;

  getExecutionContext(txHash: string): ExecutionContext;
}

export class CommonServiceImpl implements CommonService, HealthService {

  finP2PContract: FinP2PContract;
  finP2PClient: FinP2PClient | undefined;
  execDetailsStore: ExecDetailsStore | undefined;
  proofProvider: ProofProvider | undefined;
  pluginManager: PluginManager | undefined;

  private readonly registeredCredentials = new Set<string>();

  constructor(
    finP2PContract: FinP2PContract,
    finP2PClient: FinP2PClient | undefined,
    execDetailsStore: ExecDetailsStore | undefined,
    proofProvider: ProofProvider | undefined,
    pluginManager: PluginManager | undefined
  ) {
    this.finP2PContract = finP2PContract;
    this.finP2PClient = finP2PClient;
    this.execDetailsStore = execDetailsStore;
    this.proofProvider = proofProvider;
    this.pluginManager = pluginManager;
  }

  protected async ensureCredential(finId: string): Promise<void> {
    if (this.registeredCredentials.has(finId)) return;
    // Throws when the credential isn't registered on-chain. We deliberately
    // do NOT fall back to deriving an address from the finId and self-
    // registering it — derivation gives a key the operator has no signer
    // for (custody-managed wallets aren't derived from the finId pubkey),
    // so the resulting credential would point at a wallet nobody can sign
    // with. Let the absence propagate so the caller's failedReceiptOperation
    // path surfaces a clear "credential not found" error to the router.
    await this.finP2PContract.getCredentialAddress(finId);
    this.registeredCredentials.add(finId);
  }

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    return mapReceiptOperation(await this.finP2PContract.getReceipt(id));
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.finP2PContract.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op);
    return op as any;
  }


}
