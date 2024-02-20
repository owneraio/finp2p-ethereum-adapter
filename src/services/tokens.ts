import { v4 as uuid } from 'uuid';
import { CommonService } from './common';
import * as console from "console";
import {FinP2PContract} from "../contracts/finp2p";
import Finp2pAsset = Components.Schemas.Finp2pAsset;

let service: TokenService;

export class TokenService extends CommonService {

  constructor(finP2PContract: FinP2PContract) {
    super(finP2PContract);
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
    const assetId = request.asset.resourceId;
    const issuerFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const txHash = await this.finP2PContract.issue(assetId, issuerFinId, amount);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async transfer(request: Paths.TransferAsset.RequestBody): Promise<Paths.TransferAsset.Responses.$200> {
    const nonce = request.nonce;
    const assetId = (request.asset as Finp2pAsset).resourceId;
    const sourceFinId = request.source.finId;
    const destinationFinId = request.destination.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    const txHash = await this.finP2PContract.transfer(nonce, assetId, sourceFinId, destinationFinId, amount, settlementHash, hash, signature);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

  public async redeem(request: Paths.RedeemAssets.RequestBody): Promise<Paths.RedeemAssets.Responses.$200> {
    const nonce = request.nonce;
    const assetId = (request.asset as Finp2pAsset).resourceId;
    const finId = request.source.finId;
    const amount = parseInt(request.quantity);
    const settlementHash = request.signature.template.hashGroups[1].hash;
    const hash = request.signature.template.hash;
    const signature = request.signature.signature;

    const txHash = await this.finP2PContract.redeem(nonce, assetId, finId, amount, settlementHash, hash, signature);

    return {
      isCompleted: false,
      cid: txHash,
    } as Components.Schemas.ReceiptOperation;
  }

}

