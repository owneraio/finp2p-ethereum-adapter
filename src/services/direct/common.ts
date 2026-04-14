import { CommonService, OperationStatus, ReceiptOperation, workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter'

type WorkflowStorage = InstanceType<typeof workflows.WorkflowStorage>;

export class CommonServiceImpl implements CommonService {
  constructor(private readonly storage: WorkflowStorage) {}

  async getReceipt(id: string): Promise<ReceiptOperation> {
    const operation = await this.storage.getReceiptOperation(id)
    if (operation === undefined) throw new Error(`Operation containing receipt '${id}' not found`)
    return operation.outputs
  }

  operationStatus(cid: string): Promise<OperationStatus> {
    throw new Error('Method not implemented.');
  }
}
