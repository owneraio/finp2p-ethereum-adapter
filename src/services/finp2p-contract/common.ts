import {
  CommonService, HealthService, OperationStatus,
  ProofProvider, PluginManager
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { ReceiptOperation, ExecutionContext, FinP2PContract, finIdToAddress } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";


export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;

  getExecutionContext(txHash: string): ExecutionContext;
}

// TODO: update finp2p-contracts adapter-types to match skeleton 0.28 types
export class CommonServiceImpl implements HealthService {

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
    try {
      await this.finP2PContract.getCredentialAddress(finId);
    } catch {
      const address = finIdToAddress(finId);
      await this.finP2PContract.addCredential(finId, address);
    }
    this.registeredCredentials.add(finId);
  }

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    return await this.finP2PContract.getReceipt(id) as any;
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    return await this.finP2PContract.getOperationStatus(cid) as any;
  }


}
