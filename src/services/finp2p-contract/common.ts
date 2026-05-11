import {
  CommonService, HealthService, OperationStatus,
  ProofProvider, PluginManager,
  ReceiptOperation, ExecutionContext,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PContract, finIdToAddress } from "@owneraio/finp2p-contracts";
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
    try {
      await this.finP2PContract.getCredentialAddress(finId);
    } catch (e) {
      // LEGACY_AUTO_DERIVE_CREDENTIAL=true — opt-in compatibility flag for
      // test frameworks where wallets are derived from finIds (the
      // `finIdToAddress(finId)` is the operator-controlled wallet by
      // construction). Off in production: custody-managed wallets aren't
      // derived from finIds, so auto-registering a derived address would
      // create a credential pointing at a wallet nobody can sign with.
      if (process.env.LEGACY_AUTO_DERIVE_CREDENTIAL !== 'true') throw e;
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
    return mapReceiptOperation(await this.finP2PContract.getReceipt(id));
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.finP2PContract.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op);
    return op as any;
  }


}
