import {
  CommonService, HealthService, OperationStatus,
  ProofProvider, PluginManager,
  ReceiptOperation, ExecutionContext,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PContract, finIdToAddress, ReceiptOperation as ContractReceiptOperation } from "@owneraio/finp2p-contracts";

function mapAccount(acc: { finId: string; account?: string } | undefined) {
  if (!acc) return undefined;
  return { finId: acc.finId, account: acc.account ? { type: 'ledger', address: acc.account } : undefined };
}

export function mapReceiptOperation(op: ContractReceiptOperation): ReceiptOperation {
  if (op.type !== 'success') return op as any;
  return {
    ...op,
    receipt: {
      ...op.receipt,
      source: mapAccount(op.receipt.source as any),
      destination: mapAccount(op.receipt.destination as any),
    },
  } as any;
}
import { FinP2PClient } from "@owneraio/finp2p-client";


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
    return mapReceiptOperation(await this.finP2PContract.getReceipt(id));
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.finP2PContract.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op);
    return op as any;
  }


}
