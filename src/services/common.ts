import {
  CommonService,
  HealthService,
  OperationStatus,
  ReceiptOperation,
  ExecutionContext
} from "@owneraio/finp2p-adapter-models";
import {
  ProofProvider, PluginManager
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract
} from "@owneraio/finp2p-contracts";


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

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    return await this.finP2PContract.getReceipt(id);
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    return await this.finP2PContract.getOperationStatus(cid);
  }

  //   protected async providePreviousInstructionProofIfExists(planId: string, currentSequence: number) {
  //     if (!this.executionGetter) {
  //       throw new Error("Execution getter is not set");
  //     }
  //     const { domain, id, operation, source, destination, asset,
  //       tradeDetails, transactionDetails,  quantity, signature} = await this.executionGetter.getPreviousInstructionProof(planId, currentSequence);
  //     const txHash = await this.finP2PContract.provideInstructionProof(domain, id, operation, source, destination, asset, tradeDetails, transactionDetails, quantity, signature);
  //     await this.finP2PContract.waitForCompletion(txHash)
  //   }

}
