import { OssClient, Proof } from "./oss.client";
import process from "process";


export class PolicyGetter {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async getPolicy(assetCode: string, assetType: 'cryptocurrency' | 'fiat' | 'finp2p') {
    let proof: Proof;
    switch (assetType) {
      case 'finp2p': {
        ({ policies: { proof } } = await this.ossClient.getAsset(assetCode));
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

        break
      case 'SignatureProofPolicy':
        proof.signatureTemplate
        proof.verifyingKey
        break
    }
  }


}