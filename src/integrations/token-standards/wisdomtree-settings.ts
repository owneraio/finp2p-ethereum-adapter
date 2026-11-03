import type { WisdomTreeConnectSettings, WisdomTreeProduct } from "@owneraio/finp2p-ethereum-wisdomtree-connect";

export type WisdomTreeSettings = {
  connect: WisdomTreeConnectSettings;
  products: Record<string, WisdomTreeProduct>;
  organizationGuid?: string;
  waitSeconds?: number;
  pollIntervalMs?: number;
};

export function wisdomTreeSettings(env: NodeJS.ProcessEnv): WisdomTreeSettings | undefined {
  const baseUrl = env.WISDOMTREE_CONNECT_BASE_URL;
  if (!baseUrl) return undefined;
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`WISDOMTREE_CONNECT_BASE_URL is set but ${name} is not`);
    return value;
  };
  const positive = (name: string): number | undefined => {
    const value = env[name];
    if (value === undefined || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer, got '${value}'`);
    return parsed;
  };
  return {
    connect: {
      baseUrl,
      clientId: required("WISDOMTREE_CONNECT_CLIENT_ID"),
      clientSecret: required("WISDOMTREE_CONNECT_CLIENT_SECRET"),
      username: required("WISDOMTREE_CONNECT_USERNAME"),
      password: required("WISDOMTREE_CONNECT_PASSWORD"),
    },
    products: parseProducts(required("WISDOMTREE_PRODUCTS")),
    organizationGuid: env.WISDOMTREE_ORGANIZATION_GUID || undefined,
    waitSeconds: positive("WISDOMTREE_WAIT_SECONDS"),
    pollIntervalMs: positive("WISDOMTREE_POLL_INTERVAL_MS"),
  };
}

function parseProducts(json: string): Record<string, WisdomTreeProduct> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`WISDOMTREE_PRODUCTS is not JSON: ${e}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new Error(`WISDOMTREE_PRODUCTS must map token addresses to Connect products`);
  }
  for (const [token, product] of Object.entries(parsed as Record<string, any>)) {
    for (const field of ["exchangeCode", "blockchain", "settlementCurrency"]) {
      if (typeof product?.[field] !== "string" || !product[field]) {
        throw new Error(`WISDOMTREE_PRODUCTS['${token}'] has no ${field}`);
      }
    }
    if (product.orderType !== undefined && product.orderType !== "primary" && product.orderType !== "secondary") {
      throw new Error(`WISDOMTREE_PRODUCTS['${token}'].orderType must be primary or secondary`);
    }
  }
  return parsed as Record<string, WisdomTreeProduct>;
}
