import { logger } from '../helpers/logger';
import { CommonService } from './common';
import { EthereumTransactionError } from '../../finp2p-contracts/src/contracts/model';
import { extractParameterEIP712, failedTransaction } from "./mapping";
import { PrimaryType } from "../../finp2p-contracts/src/contracts/eip712";

export class EscrowService extends CommonService {

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    const { operationId, asset, source, destination, quantity, nonce } = request;

    const { signature, template } = request.signature;

    try {
      const {eip712PrimaryType, /* hashType,*/ assetId, assetAmount, settlementAsset, settlementAmount, buyerFinId, sellerFinId, issuerFinId } = extractParameterEIP712(template);
      let txHash: string;
      switch (eip712PrimaryType) {
        case PrimaryType.PrimarySale:
          if (asset.type !== 'fiat' && asset.type !== 'cryptocurrency') {
            return failedTransaction(1, 'Payment hold is only supported for fiat and cryptocurrency assets');
          }
          if (source.finId !== buyerFinId) {
            return failedTransaction(1, `Requested buyer finId does not match the buyer finId in the template`);
          }
          if (destination && destination.finId !== issuerFinId) {
            return failedTransaction(1, `Requested seller finId does not match the seller finId in the template`);
          }

          if (asset.code !== settlementAsset) {
            return failedTransaction(1, `Requested settlement asset code does not match the settlement asset code in the template`);
          }
          if (settlementAmount !== quantity) {
            return failedTransaction(1, `Requested settlement amount does not match the settlement amount in the template`);
          }

          txHash = await this.finP2PContract.holdPayments(operationId, nonce, assetId, sellerFinId, buyerFinId, assetAmount,
            settlementAsset, settlementAmount, /*hashType,*/ signature);
          break
        case PrimaryType.Buying:
        case PrimaryType.Selling:
        case PrimaryType.PrivateOffer:
          if (asset.type !== 'fiat' && asset.type !== 'cryptocurrency') {
            return failedTransaction(1, 'Payment hold is only supported for fiat and cryptocurrency assets');
          }
          if (source.finId !== buyerFinId) {
            return failedTransaction(1, `Requested buyer finId does not match the buyer finId in the template`);
          }
          if (destination && destination.finId !== sellerFinId) {
            return failedTransaction(1, `Requested seller finId does not match the seller finId in the template`);
          }

          if (asset.code !== settlementAsset) {
            return failedTransaction(1, `Requested settlement asset code does not match the settlement asset code in the template`);
          }
          if (settlementAmount !== quantity) {
            return failedTransaction(1, `Requested settlement amount does not match the settlement amount in the template`);
          }

          txHash = await this.finP2PContract.holdPayments(operationId, nonce, assetId, sellerFinId, buyerFinId, assetAmount,
            settlementAsset, settlementAmount, /*hashType,*/ signature);
          break

        case PrimaryType.Redemption:
          if (source.finId !== sellerFinId) {
            return failedTransaction(1, `Requested source finId does not match the seller finId in the template`);
          }
          if (destination && destination.finId !== issuerFinId) {
            return failedTransaction(1, `Requested destination finId does not match the issuer finId in the template`);
          }
          if (asset.type !== 'finp2p') {
            return failedTransaction(1, 'Asset hold is only supported for finp2p assets');
          }
          if (asset.resourceId !== assetId) {
            return failedTransaction(1, `Requested asset id for finp2p asset does not match the asset id in the template`);
          }
          if (assetAmount !== quantity) {
            return failedTransaction(1, `Requested asset amount for finp2p asset does not match the asset amount in the template`);
          }
          txHash = await this.finP2PContract.holdAssets(operationId, nonce, assetId, sellerFinId, issuerFinId, assetAmount,
            settlementAsset, settlementAmount, /*hashType,*/ signature);
          break

        // case EIP712PrimaryType.Loan:

        default:
          return failedTransaction(1, `Unsupported primary type: ${eip712PrimaryType}`);
      }

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

}

