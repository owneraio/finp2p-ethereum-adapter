import CreateAssetProfile = FinAPIPaths.CreateAssetProfile;
import ShareProfile = FinAPIPaths.ShareProfile;
import OperationBase = FinAPIComponents.Schemas.OperationBase;
import IntentType = FinAPIComponents.Schemas.IntentType;
import * as axios from "axios";
import ResourceIdResponse = FinAPIComponents.Schemas.ResourceIdResponse;
import AssetMetadataAndConfigError = Components.Schemas.AssetMetadataAndConfigError;
import GeneralClientError = Components.Schemas.GeneralClientError;

export class FinAPIClient {

  finP2PUrl: string;
  authTokenResolver: (() => string) | undefined;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = finP2PUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async createAsset(name: string, type: string, issuerId: string, currency: string, currencyType: 'fiat' | 'cryptocurrency', intentTypes: IntentType[], metadata: any) {
    return await this.post<CreateAssetProfile.RequestBody, FinAPIComponents.Schemas.ResourceIdResponse | OperationBase | FinAPIComponents.Schemas.ApiAnyError>(
      `/profiles/asset`, {
        metadata,
        intentTypes,
        name,
        type,
        issuerId,
        denomination: {
          type: currencyType,
          code: currency
        },
        // ledgerAssetBinding: {
        //   type: "tokenId",
        //   tokenId
        // },
        assetPolicies: {
          proof: undefined // TBD
        }
      });
  }

  async shareProfile(id: string, organizations: string[]) {
    return await this.post<ShareProfile.RequestBody, ShareProfile.Responses.$200>(
      `/profiles/${id}/share`, {
        organizations
      });
  }

  async getProfileOperationStatus(id: Paths.GetOperation.Parameters.Cid): Promise<{
    cid?: string;
    isCompleted: boolean;
    type: "profile";
    response?: ResourceIdResponse;
    errors: (AssetMetadataAndConfigError | GeneralClientError)[]
  } > {
    return await this.get(`/operations/status/${id}`);
  }

  async sendCallback(cid: string, operationStatus: Components.Schemas.OperationStatus): Promise<{}> {
    return await this.post<Components.Schemas.OperationStatus, {}>(
      `/operations/callback/${cid}`, operationStatus);
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