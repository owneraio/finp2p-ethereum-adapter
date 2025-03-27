import Execution = FinAPIComponents.Schemas.Execution;
import * as axios from 'axios';

export class FinAPIClient {

  finP2PUrl: string;
  authTokenResolver: (() => string) | undefined;

  constructor(finP2PUrl: string, authTokenResolver: (() => string) | undefined = undefined) {
    this.finP2PUrl = finP2PUrl;
    this.authTokenResolver = authTokenResolver;
  }

  async getExecutionPlan(planId: string): Promise<Execution> {
    return this.post(`/execution/${planId}`);
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