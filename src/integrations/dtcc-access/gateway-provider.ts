import { FetchRequest, JsonRpcProvider, Network } from "ethers";
import { DtccAccess } from "./access";

/**
 * JSON-RPC through the DTCC Gateway: every request carries the current service-account token.
 * With a known chain id the provider skips network detection, so calls fail at once
 * (rather than retry forever) while no token can be issued.
 */
export function dtccGatewayProvider(rpcUrl: string, access: DtccAccess, chainId?: bigint): JsonRpcProvider {
  const request = new FetchRequest(rpcUrl);
  request.preflightFunc = async (req) => {
    req.setHeader('authorization', `Bearer ${await access.token()}`);
    return req;
  };
  return chainId === undefined
    ? new JsonRpcProvider(request)
    : new JsonRpcProvider(request, undefined, { staticNetwork: Network.from(chainId) });
}
