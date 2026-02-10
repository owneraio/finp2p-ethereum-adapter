import { CommonService, OperationStatus, ReceiptOperation } from '@owneraio/finp2p-adapter-models'
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter'

export class CommonServiceImpl implements CommonService {
  async getReceipt(id: string): Promise<ReceiptOperation> {
    const operation = await workflows.getReceiptOperation(id)
    if (operation === undefined) throw new Error(`Operation containing receipt '${id}' not found`)
    // validate that tx with hash exists in blockchain
    // used by finp2p-node during audits
    return operation.outputs
  }

  operationStatus(cid: string): Promise<OperationStatus> {
    throw new Error('Method not implemented.');
  }
}
