import { OssClient } from "./oss.client";
import { Proof, ProofDomain, parseProofDomain, ProofPolicy } from "./model";
import process from "process";



export class PolicyGetter {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async getPolicy(assetCode: string, assetType: 'cryptocurrency' | 'fiat' | 'finp2p'): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string
    switch (assetType) {
      case 'finp2p': {
        ({ policies: { proof }, config: configRaw } = await this.ossClient.getAsset(assetCode));
        domain = parseProofDomain(configRaw);
        break
      }
      case 'cryptocurrency':
      case 'fiat': {
        const orgId = process.env.ORGANIZATION_ID || '';
        ({ policies: { proof } } = await this.ossClient.getPaymentAsset(orgId, assetCode));
        break
      }
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