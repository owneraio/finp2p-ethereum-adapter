import CreateAssetProfile = FinAPIPaths.CreateAssetProfile;
import OperationBase = FinAPIComponents.Schemas.OperationBase;
import IntentType = FinAPIComponents.Schemas.IntentType;
import * as axios from "axios";
import ResourceIdResponse = FinAPIComponents.Schemas.ResourceIdResponse;

export class FinAPIClient {

  finP2PUrl: string;
  authTokenResolver: (() => string) | undefined;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = finP2PUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async createAsset(name: string, type: string, issuerId: string, tokenId: string, intentTypes: IntentType[], metadata: any) {
    return await this.post<CreateAssetProfile.RequestBody, FinAPIComponents.Schemas.ResourceIdResponse | OperationBase | FinAPIComponents.Schemas.ApiAnyError>(
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

  async getOperationStatus(id: Paths.GetOperation.Parameters.Cid): Promise<{
    cid?: string;
    isCompleted: boolean;
    type: "profile";
    response?: ResourceIdResponse;
  } > {
    return await this.get(`/operations/status/${id}`);
  }

  private async get<Response>(path: string): Promise<Response> {
    let headers = {
      "Accept": "application/json"
    } as Record<string, string>;
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }
    const { data } = await axios.default.get<Response>(this.finP2PUrl + path, { headers });
    return data;
  }

  private async post<Request, Response>(path: string, request: Request | undefined = undefined): Promise<Response> {
    let headers = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    } as Record<string, string>;
    if (this.authTokenResolver) {
      headers.Authorization = `Bearer ${this.authTokenResolver()}`;
    }
    const { data } = await axios.default.post<Response>(this.finP2PUrl + path, request, { headers });
    return data;
  }
}