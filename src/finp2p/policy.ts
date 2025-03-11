import { OssClient } from "./oss.client";
import { Proof, ProofDomain, parseProofDomain, ProofPolicy } from "./model";
import process from "process";
import console from "console";



export class PolicyGetter {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async getPolicy(assetCode: string, assetType: string): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string
    switch (assetType) {
      case 'finp2p': {
        try {
          ({ policies: { proof }, config: configRaw } = await this.ossClient.getAsset(assetCode));
          domain = parseProofDomain(configRaw);
          break
        } catch (e) {
          console.log(e)
        }
      }
      case 'cryptocurrency':
      case 'fiat': {
        const orgId = process.env.ORGANIZATION_ID || '';
        ({ policies: { proof } } = await this.ossClient.getPaymentAsset(orgId, assetCode));
        break
      }
      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    switch (proof.type) {
      case 'NoProofPolicy':
        return { type: 'NoProofPolicy' }
      case 'SignatureProofPolicy': {
        return { ...proof, domain }
      }
    }
  }


}