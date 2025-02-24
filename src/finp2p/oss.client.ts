import 'graphql-import-node';
import { DocumentNode } from 'graphql';
import GET_OWNERS from './graphql/owners.graphql';
import GET_ASSET from './graphql/asset.graphql';
import GET_ALL_ASSETS from './graphql/all-assets.graphql';
import GET_PAYMENT_ASSET from './graphql/paymentAsset.graphql';
import * as axios from 'axios';

export type Proof = {
  type: 'NoProofPolicy'
} | {
  type: 'SignatureProofPolicy',
  verifyingKey: string,
  signatureTemplate: string
}

export class OssClient {

  ossUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(ossUrl: string, authTokenResolver: (() => string) | undefined) {
    this.ossUrl = ossUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async getOwnerByFinId(finId: string) {
    const resp = await this.queryOss<{
      users: {
        nodes: {
          id: string,
          name: string,
          finIds: string[]
          organizationId: string,
          certificates: {
            nodes: {
              id: string,
              profileId: string,
              type: string,
              data: string,
              expiry: number
            }[]
          }
          metadata: {
            acl: string[]
          }
        }[]
      }
    }>(GET_OWNERS, { userFilter: { key: 'finIds', operator: 'CONTAINS', value: finId }, includeCerts: true, includeHoldings: false });
    return resp.users.nodes[0];
  }

  async getAsset(assetId: string) {
    const resp = await this.queryOss<{
      assets: {
        nodes: {
          id: string,
          name: string,
          type: string,
          organizationId: string,
          denomination: {
            code: string
          },
          issuerId: string,
          config: string,
          allowedIntents: string[],
          regulationVerifiers: {
            id: string,
            name: string,
            provider: string
          }[]
          policies: {
            proof: Proof
          }
          certificates: {
            nodes: {
              id: string,
              profileId: string,
              type: string,
              data: string,
              expiry: number
            }[]
          }
        }[]
      }
    }>(GET_ASSET, { assetId });
    return resp.assets.nodes[0];
  }


  async getPaymentAsset(orgId: string, assetCode: string) {
    const resp = await this.queryOss<{
      assets: {
        nodes: {
          id: string,
          name: string,
          type: string,
          organizationId: string,
          denomination: {
            code: string
          },
          issuerId: string,
          config: string,
          allowedIntents: string[],
          regulationVerifiers: {
            id: string,
            name: string,
            provider: string
          }[]
          policies: {
            proof: Proof
          }
          certificates: {
            nodes: {
              id: string,
              profileId: string,
              type: string,
              data: string,
              expiry: number
            }[]
          }
        }[]
      }
    }>(GET_PAYMENT_ASSET, { orgId });
    return resp.assets.nodes[0];
  }

  async getAllAssetIds() {
    const resp = await this.queryOss<{
      assets: {
        nodes: {
          id: string,
        }[]
      }
    }>(GET_ALL_ASSETS, {});
    return resp.assets.nodes.map(asset => asset.id);
  }

  async queryOss<T>(queryDoc: DocumentNode, variables: Record<string, any>): Promise<T> {
    let headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    } as Record<string, string>;
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }

    const response = await axios.default.post<GraphqlResponse<T>>(
      this.ossUrl,
      {
        query: queryDoc.loc?.source.body,
        variables,
      },
      {
        headers,
      });
    return response.data.data;
  }

}

type GraphqlResponse<T> = {
  data: T
};