import CreateAssetProfile = FinAPIPaths.CreateAssetProfile;
import IntentType = FinAPIComponents.Schemas.IntentType;
import * as axios from "axios";

export class FinAPIClient {

  finP2PUrl: string;
  authTokenResolver: (() => string) | undefined;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = finP2PUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async createAsset(name: string, type: string, issuerId: string, tokenId: string, intentTypes: IntentType[], metadata: any) {
    return await this.post<CreateAssetProfile.RequestBody, FinAPIComponents.Schemas.ResourceIdResponse | FinAPIComponents.Schemas.OperationBase | FinAPIComponents.Schemas.ApiAnyError>(
      `/profiles/asset`, {
        metadata,
        intentTypes,
        name,
        type,
        issuerId,
        denomination: {
          type: "fiat",
          code: "USD"
        },
        ledgerAssetBinding: {
          type: "tokenId",
          tokenId
        },
        assetPolicies: {
          proof: undefined // TBD
        }
      });
  }

  private async post<Request, Response>(path: string, request: Request | undefined = undefined): Promise<Response> {
    let headers = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    } as Record<string, string>;
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }
    const response = await axios.default.post<Response>(this.finP2PUrl + path, request, { headers });
    return response.data;
  }
}