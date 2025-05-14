import 'graphql-import-node';
import { DocumentNode } from 'graphql';
import GET_OWNERS from './graphql/owners.graphql';
import GET_ASSET from './graphql/asset.graphql';
import GET_ALL_ASSETS from './graphql/all-assets.graphql';
import GET_PAYMENT_ASSET from './graphql/paymentAsset.graphql';
import * as axios from 'axios';
import { OssAssetNodes, OssOwnerNodes } from "./model";

export class OssClient {

  ossUrl: string;

  authTokenResolver: (() => string) | undefined;

  constructor(ossUrl: string, authTokenResolver: (() => string) | undefined) {
    this.ossUrl = ossUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async getOwnerBalances(assetId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(GET_OWNERS, { userFilter: undefined, includeCerts: false, includeHoldings: true });
    return resp.users.nodes.filter((o) => o.holdings.nodes.some(n => n.asset.resourceId === assetId))
      .map(o => ({ finId: o.finIds[0], balance: o.holdings.nodes.find(n => n.asset.resourceId === assetId)!.balance}));
  }

  async getOwnerByFinId(finId: string) {
    const resp = await this.queryOss<OssOwnerNodes>(GET_OWNERS, { userFilter: { key: 'finIds', operator: 'CONTAINS', value: finId }, includeCerts: true, includeHoldings: false });
    return resp.users.nodes[0];
  }

  async getAsset(assetId: string) {
    const resp = await this.queryOss<OssAssetNodes>(GET_ASSET, { assetId });
    return resp.assets.nodes[0];
  }

  async getPaymentAsset(orgId: string, assetCode: string) {
    const resp = await this.queryOss<OssAssetNodes>(GET_PAYMENT_ASSET, { orgId });
    return resp && resp.assets && resp.assets.nodes.length > 0 ? resp.assets.nodes[0] : undefined;
  }

  async getAssetsWithTokens(): Promise<{assetId: string, tokenAddress: string}[]> {
    const resp = await this.queryOss<OssAssetNodes>(GET_ALL_ASSETS, {});
    return resp.assets.nodes.
      filter(a => a.ledgerAssetInfo.tokenId.length > 0).
      map(a => ({ assetId: a.id, tokenAddress: a.ledgerAssetInfo.tokenId}));
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