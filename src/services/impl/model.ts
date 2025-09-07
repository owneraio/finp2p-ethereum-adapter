

export type AssetCreationPolicy = | { type: "deploy-new-token"; decimals: number } | {
  type: "reuse-existing-token";
  tokenAddress: string
} | { type: "no-deployment" };
