import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { assetFromAPI, receiptToAPI, receiptToEIP712Message } from "./mapping";
import { Receipt } from "../finp2p/graphql";
import { FinP2PReceipt } from "../../finp2p-contracts/src/contracts/model";
import { OssClient } from "../finp2p/oss.client";
import process from "process";
import { PolicyGetter } from "../finp2p/policy";
import { newReceiptMessage, RECEIPT_PROOF_TYPES } from "../../finp2p-contracts/src/contracts/eip712";


export class CommonService {

  finP2PContract: FinP2PContract;
  policyGetter: PolicyGetter

  constructor(finP2PContract: FinP2PContract, ossClient: PolicyGetter) {
    this.finP2PContract = finP2PContract;
    this.policyGetter = ossClient;
  }

  public async balance(request: Paths.GetAssetBalance.RequestBody): Promise<Paths.GetAssetBalance.Responses.$200> {
    logger.debug('balance', { request });

    const { assetId } = assetFromAPI(request.asset);
    const balance = await this.finP2PContract.balance(assetId, request.owner.finId);

    return {
      asset: request.asset,
      balance: `${balance}`,
    } as Components.Schemas.Balance;
  }

  public async getReceipt(id: Paths.GetReceipt.Parameters.TransactionId): Promise<Paths.GetReceipt.Responses.$200> {
    try {
      const receipt = await this.finP2PContract.getReceipt(id);
      return {
        isCompleted: true,
        response: receiptToAPI(receipt),
      } as Components.Schemas.ReceiptOperation;

    } catch (e) {
      return {
        isCompleted: true,
        error: {
          code: 1,
          message: e,
        },
      } as Components.Schemas.ReceiptOperation;
    }
  }

  public async operationStatus(cid: string): Promise<Paths.GetOperation.Responses.$200> {
    const status = await this.finP2PContract.getOperationStatus(cid);
    switch (status.status) {
      case 'completed':
        const receipt = receiptToAPI(await this.ledgerProof(status.receipt));

        return {
          type: 'receipt',
          operation: {
            isCompleted: true,
            response: receipt,
          },
        } as Components.Schemas.OperationStatus;

      case 'pending':
        return {
          type: 'receipt',
          operation: {
            isCompleted: false,
            cid: cid,
          },
        } as Components.Schemas.OperationStatus;

      case 'failed':
        return {
          type: 'receipt',
          operation: {
            isCompleted: true,
            error: status.error,
          },
        } as Components.Schemas.OperationStatus;
    }
  }

  private async ledgerProof(receipt: FinP2PReceipt): Promise<FinP2PReceipt> {
    const policy = await this.policyGetter.getPolicy(receipt.assetId, receipt.assetType)
    switch (policy.type) {
      case 'NoProofPolicy':
        receipt.proof = {
          type: 'no-proof'
        }
        return receipt;
      case 'SignatureProofPolicy':
        const { signatureTemplate } = policy;
        if (signatureTemplate !== 'eip712') {
          throw new Error(`Unsupported signature template: ${signatureTemplate}`);
        }
        const message = receiptToEIP712Message(receipt);
        const domain = await this.finP2PContract.eip712Domain();
        receipt.proof = {
          type: 'signature-proof',
          template: {
            primaryType: '',
            domain,
            message,
            types: RECEIPT_PROOF_TYPES
          },
          signature: await this.finP2PContract.signEIP712(
            RECEIPT_PROOF_TYPES,
            message
          )
        }
        return receipt;
    }
  }
}
