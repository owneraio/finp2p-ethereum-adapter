import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { assetFromAPI, extractParameterEIP712, failedTransaction } from "./mapping";
import { Leg } from "../../finp2p-contracts/src/contracts/eip712";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { operationId, asset, source, destination, quantity, nonce } = request;
    const reqAsset = assetFromAPI(asset)
    const { signature, template } = request.signature;

    try {
      const { buyerFinId, sellerFinId, asset, settlement, leg, eip712PrimaryType } = extractParameterEIP712(template, reqAsset);
      switch (leg) {
        case Leg.Asset:
          if (destination && buyerFinId !== destination.finId) {
            return failedTransaction(1, `Buyer FinId in the signature does not match the destination FinId`);
          }
          if (sellerFinId !== source.finId) {
            return failedTransaction(1, `Seller FinId in the signature does not match the source FinId`);
          }
          if (quantity !== asset.amount) {
            return failedTransaction(1, `Quantity in the signature does not match the requested quantity`);
          }
          break
        case Leg.Settlement:
          if (destination && sellerFinId !== destination.finId) {
            return failedTransaction(1, `Seller FinId in the signature does not match the destination FinId`);
          }
          if (buyerFinId !== source.finId) {
            return failedTransaction(1, `Buyer FinId in the signature does not match the source FinId`);
          }
          if (quantity !== settlement.amount) {
            return failedTransaction(1, `Quantity in the signature does not match the requested quantity`);
          }
          break
      }

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
    const { operationId, destination, quantity} = request;

    try {
      const txHash = await this.finP2PContract.release(operationId, destination.finId, quantity);

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
      const txHash = await this.finP2PContract.rollback(operationId);

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

  public async withholdRedeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const { operationId, source, quantity} = request;
    if (!operationId) {
      return failedTransaction(1, 'operationId is required');
    }

    try {
      const txHash = await this.finP2PContract.withholdRedeem(operationId, source.finId, quantity);

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


}

