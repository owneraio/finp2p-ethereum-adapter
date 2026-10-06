import { CommonService, OperationStatus, ReceiptOperation, workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter'

type WorkflowStorage = InstanceType<typeof workflows.WorkflowStorage>;

export class CommonServiceImpl implements CommonService {
  constructor(private readonly storage: WorkflowStorage) {}

  async getReceipt(id: string): Promise<ReceiptOperation> {
    const operation = await this.storage.getOperationByReceiptId(id)
    if (operation === undefined) throw new Error(`Operation containing receipt '${id}' not found`)
    return operation.outputs
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    const operation = await this.storage.getOperationByCid(cid);
    if (operation === undefined) throw new Error(`Operation '${cid}' not found`);
    return operation.outputs;
  }
}
