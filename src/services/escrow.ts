import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { assetFromAPI, extractParameterEIP712, failedTransaction } from "./mapping";
import { Leg } from "../../finp2p-contracts/src/contracts/eip712";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { operationId, asset, source, destination, quantity, signature: { signature, template }, nonce } = request;
    const reqAsset = assetFromAPI(asset)

    try {
      const { buyerFinId, sellerFinId, asset, settlement, leg, eip712PrimaryType } = extractParameterEIP712(template, reqAsset);
      const txHash =  await this.finP2PContract.hold(operationId, nonce,
        sellerFinId, buyerFinId, asset, settlement, leg, eip712PrimaryType, signature);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;

    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    const { operationId, destination, asset, quantity } = request;
    const reqAsset = assetFromAPI(asset)

    try {
      const txHash = await this.finP2PContract.release(operationId, destination.finId, quantity, Leg.Settlement /* TODO: identify the leg */);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    }  catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);
      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    const operationId = request.operationId;

    try {
      const txHash = await this.finP2PContract.rollback(operationId, Leg.Settlement /* TODO: identify the leg */);

      return {
        isCompleted: false,
        cid: txHash,
      } as Components.Schemas.ReceiptOperation;
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedTransaction(1, e.message);

      } else {
        return failedTransaction(1, `${e}`);
      }
    }
  }

}

