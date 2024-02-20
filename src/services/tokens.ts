import { v4 as uuid } from 'uuid';
import { CommonService } from './common';
import * as console from "console";
import {FinP2PContract} from "../contracts/finp2p";

let service: TokenService;

export class TokenService extends CommonService {

  finP2PContract: FinP2PContract

  constructor(finP2PContract: FinP2PContract) {
    super();
    this.finP2PContract = finP2PContract
  }

  public async createAsset(request: Paths.CreateAsset.RequestBody): Promise<Paths.CreateAsset.Responses.$200> {
    console.log(`request: ${request}`);
    const txId = uuid();
    return {
      isCompleted: true,
      cid: txId,
    } as Components.Schemas.EmptyOperation;
  }

  public async issue(request: Paths.IssueAssets.RequestBody): Promise<Paths.IssueAssets.Responses.$200> {
    const amount = parseInt(request.quantity);


    return {
      isCompleted: true,
      // cid: ?,
      // response: ?,
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const amount = parseInt(request.quantity);

    return {
      isCompleted: true,
      // cid: ?,
      // response: ?,
    } as Components.Schemas.ReceiptOperation;
  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const amount = parseInt(request.quantity);

    return {
      isCompleted: true,
      // cid: ?,
      // response: ?,
    } as Components.Schemas.ReceiptOperation;
  }

}

