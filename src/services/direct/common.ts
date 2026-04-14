import { CommonService, OperationStatus, ReceiptOperation } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { StorageInstance } from './account-mapping';

export class CommonServiceImpl implements CommonService {
  constructor(private readonly storage: StorageInstance) {}

  async getReceipt(id: string): Promise<ReceiptOperation> {
    const operation = await this.storage.getReceiptOperation(id)
    if (operation === undefined) throw new Error(`Operation containing receipt '${id}' not found`)
    return operation.outputs
  }

  operationStatus(cid: string): Promise<OperationStatus> {
    throw new Error('Method not implemented.');
  }
}
