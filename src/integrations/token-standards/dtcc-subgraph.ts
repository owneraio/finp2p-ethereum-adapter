import { Agent, fetch as undiciFetch } from "undici";
import { SubgraphClient, SubgraphFetch } from "@owneraio/finp2p-ethereum-dtcc-plugin";

/**
 * DTCC subgraph client with every URL derived from SUBGRAPH_BASE_URL (no SUBGRAPH_* fallback).
 * SUBGRAPH_AUTH ("user:password") adds basic auth; SUBGRAPH_TLS_CERT + SUBGRAPH_TLS_PRIVATE_KEY
 * (PEM, optional SUBGRAPH_TLS_CA) add a client certificate.
 */
export function dtccSubgraphClient(): SubgraphClient {
  const baseUrl = process.env.SUBGRAPH_BASE_URL;
  if (!baseUrl) throw new Error('SUBGRAPH_BASE_URL is not set');
  const auth = process.env.SUBGRAPH_AUTH;
  const cert = process.env.SUBGRAPH_TLS_CERT;
  const key = process.env.SUBGRAPH_TLS_PRIVATE_KEY;
  const ca = process.env.SUBGRAPH_TLS_CA;
  if (!!cert !== !!key) {
    throw new Error('SUBGRAPH_TLS_CERT and SUBGRAPH_TLS_PRIVATE_KEY must be set together');
  }

  let fetch: SubgraphFetch | undefined;
  if (cert && key) {
    const dispatcher = new Agent({ connect: { cert, key, ca } });
    fetch = (url, init) => undiciFetch(url, { ...init, dispatcher });
  }

  return new SubgraphClient({
    baseUrl,
    tokenFactoryUrl: `${baseUrl}/token-factory-subgraph`,
    accountFactoryUrl: `${baseUrl}/account-factory-subgraph`,
    priceContextsUrl: `${baseUrl}/price-contexts-subgraph`,
    haircutContextsUrl: `${baseUrl}/haircut-contexts-subgraph`,
    headers: auth ? { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : undefined,
    fetch,
  });
}
