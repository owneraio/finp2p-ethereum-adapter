import { logger } from '../helpers/logger';
import { CommonService } from './common';
import {FinP2PContract} from "../contracts/finp2p";
import {request} from "express";

export class EscrowService extends CommonService {

  finP2PContract: FinP2PContract

  constructor(finP2PContract: FinP2PContract) {
    super();
    this.finP2PContract = finP2PContract;
  }

  public async hold(request: Paths.HoldOperation.RequestBody): Promise<Paths.HoldOperation.Responses.$200> {
    logger.debug('hold', { request });
    return {
      isCompleted: true,
      // cid: tx.id,
      // response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async release(request: Paths.ReleaseOperation.RequestBody): Promise<Paths.ReleaseOperation.Responses.$200> {
    logger.debug('release', { request });
    return {
      isCompleted: true,
      // cid: tx.id,
      // response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

  public async rollback(request: Paths.RollbackOperation.RequestBody): Promise<Paths.RollbackOperation.Responses.$200> {
    logger.debug('rollback', { request });
    return {
      isCompleted: true,
      // cid: tx.id,
      // response: Transaction.toReceipt(tx),
    } as Components.Schemas.ReceiptOperation;
  }

}

