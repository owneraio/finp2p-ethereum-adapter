import { OssClient } from "./oss.client";
import { parseProofDomain, Proof, ProofDomain, ProofPolicy } from "./model";
import process from "process";
import { AssetType } from "../../finp2p-contracts/src/contracts/model";

export class PolicyGetter {
  ossClient: OssClient;

  constructor(ossClient: OssClient) {
    this.ossClient = ossClient;
  }

  async getPolicy(assetCode: string, assetType: AssetType): Promise<ProofPolicy> {
    let proof: Proof;
    let domain: ProofDomain | null = null;
    let configRaw: string;
    switch (assetType) {
      case AssetType.FinP2P: {
        ({ policies: { proof }, config: configRaw } = await this.ossClient.getAsset(assetCode));
        domain = parseProofDomain(configRaw);
        break;
      }
      case AssetType.Cryptocurrency:
      case AssetType.Fiat: {
        const orgId = process.env.ORGANIZATION_ID || "";
        const paymentAsset = await this.ossClient.getPaymentAsset(orgId, assetCode);
        if (paymentAsset) {
          ({ policies: { proof } } = paymentAsset);
        } else {
          return { type: "NoProofPolicy" };
        }
        break;
      }
      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    switch (proof.type) {
      case "NoProofPolicy":
        return { type: "NoProofPolicy" };
      case "SignatureProofPolicy": {
        return { ...proof, domain };
      }
    }
  }


}