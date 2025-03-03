import { logger } from '../helpers/logger';
import { FinP2PContract } from '../../finp2p-contracts/src/contracts/finp2p';
import { EIP712Domain } from '../../finp2p-contracts/src/contracts/model';
import { assetFromAPI, receiptToAPI, receiptToEIP712Message } from "./mapping";
import { FinP2PReceipt } from "../../finp2p-contracts/src/contracts/model";
import { PolicyGetter } from "../finp2p/policy";
import { DOMAIN_TYPE, RECEIPT_PROOF_TYPES } from "../../finp2p-contracts/src/contracts/eip712";
import { ProofDomain } from "../finp2p/model";


export class CommonService {

  finP2PContract: FinP2PContract;
  policyGetter: PolicyGetter | undefined;

  constructor(finP2PContract: FinP2PContract, policyGetter: PolicyGetter | undefined) {
    this.finP2PContract = finP2PContract;
    this.policyGetter = policyGetter;
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
    if (this.policyGetter === undefined) {
      return receipt;
    }
    const policy = await this.policyGetter.getPolicy(receipt.assetId, receipt.assetType)
    switch (policy.type) {
      case 'NoProofPolicy':
        receipt.proof = {
          type: 'no-proof'
        }
        return receipt;
      case 'SignatureProofPolicy':
        const { signatureTemplate } = policy;
        if (signatureTemplate !== 'EIP712') {
          throw new Error(`Unsupported signature template: ${signatureTemplate}`);
        }
        const domain = await this.getDomain(policy.domain);
        const types = RECEIPT_PROOF_TYPES;
        const message = receiptToEIP712Message(receipt);
        const primaryType = 'Receipt';

        logger.info('Signing receipt with EIP712', { primaryType, domain, types, message });
        const { hash, signature } = await this.finP2PContract.signEIP712(
          domain.chainId, domain.verifyingContract, types, message);

        logger.info('Receipt signed', { hash, signature });

        // ethers doesn't allow to pass an eip712 domain in a list of types, but the domain is required on a router side
        const extendedType = { ...DOMAIN_TYPE, ...types };
        receipt.proof = {
          type: 'signature-proof',
          template: { primaryType, domain, types: extendedType, hash, message },
          signature
        }

        return receipt;
    }
  }

  private async getDomain(policyDomain: ProofDomain | null): Promise<EIP712Domain> {
    const domain = await this.finP2PContract.eip712Domain();
    if (policyDomain !== null) {
      return { ...domain, ...policyDomain }; // merge domains
    }
    return domain;
  }
}
