import { OssClient } from "./oss.client";
import { parseProofDomain, Proof, ProofDomain, ProofPolicy } from "./model";
import process from "process";
import console from "console";
import { AssetType } from "../../finp2p-contracts/src/contracts/model";

export class PolicyGetter {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async getPolicy(assetCode: string, assetType: AssetType): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string
    switch (assetType) {
      case AssetType.FinP2P: {
        try {
          ({ policies: { proof }, config: configRaw } = await this.ossClient.getAsset(assetCode));
          domain = parseProofDomain(configRaw);
          break
        } catch (e) {
          console.log(e)
        }
      }
      case AssetType.Cryptocurrency: case AssetType.Fiat: {
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