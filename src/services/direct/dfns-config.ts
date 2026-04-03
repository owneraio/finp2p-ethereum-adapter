import * as fs from "fs";
import { DfnsApiClient } from "@dfns/sdk";
import { AsymmetricKeySigner } from "@dfns/sdk-keysigner";
import { DfnsWallet } from "@dfns/lib-ethersjs6";
import { JsonRpcProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../config";

export type DfnsAppConfig = BaseAppConfig & {
  type: 'dfns'
  localSubmit?: boolean
  dfnsBaseUrl: string
  dfnsOrgId: string
  dfnsAuthToken: string
  dfnsCredId: string
  dfnsPrivateKey: string
  rpcUrl: string
  assetIssuerWalletId: string
  assetEscrowWalletId: string
  omnibusWalletId?: string
  gasFunding?: {
    walletId: string
    amount: string
  }
}

export const createDfnsEthersProvider = async (config: {
  dfnsClient: DfnsApiClient;
  walletId: string;
  rpcUrl: string;
}): Promise<{ provider: Provider; signer: Signer }> => {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const dfnsWallet = await DfnsWallet.init({
    walletId: config.walletId,
    dfnsClient: config.dfnsClient,
  });
  const signer = dfnsWallet.connect(provider);
  return { provider, signer };
};

const getNetworkRpcUrl = (): string => {
  let networkHost = process.env.NETWORK_HOST;
  if (!networkHost) {
    throw new Error("NETWORK_HOST is not set");
  }
  const ethereumRPCAuth = process.env.NETWORK_AUTH;
  if (ethereumRPCAuth) {
    if (networkHost.startsWith("https://")) {
      networkHost = "https://" + ethereumRPCAuth + "@" + networkHost.replace("https://", "");
    } else if (networkHost.startsWith("http://")) {
      networkHost = "http://" + ethereumRPCAuth + "@" + networkHost.replace("http://", "");
    } else {
      networkHost = ethereumRPCAuth + "@" + networkHost;
    }
  }
  return networkHost;
};

export async function createDfnsAppConfig(): Promise<Omit<DfnsAppConfig, 'accountMappingType' | 'accountModel'>> {
  const orgId = process.env.ORGANIZATION_ID || '';
  const dfnsBaseUrl = process.env.DFNS_BASE_URL || 'https://api.dfns.io';
  const dfnsOrgId = process.env.DFNS_ORG_ID;
  if (!dfnsOrgId) throw new Error('DFNS_ORG_ID is not set');

  const dfnsAuthToken = process.env.DFNS_AUTH_TOKEN;
  if (!dfnsAuthToken) throw new Error('DFNS_AUTH_TOKEN is not set');

  const dfnsCredId = process.env.DFNS_CRED_ID;
  if (!dfnsCredId) throw new Error('DFNS_CRED_ID is not set');

  const privateKeyPath = process.env.DFNS_PRIVATE_KEY_PATH;
  const privateKeyEnv = process.env.DFNS_PRIVATE_KEY;
  const dfnsPrivateKey = privateKeyPath
    ? fs.readFileSync(privateKeyPath, 'utf-8')
    : privateKeyEnv;
  if (!dfnsPrivateKey) throw new Error('DFNS_PRIVATE_KEY or DFNS_PRIVATE_KEY_PATH is not set');

  const rpcUrl = getNetworkRpcUrl();
  const provider = new JsonRpcProvider(rpcUrl);

  const issuerWalletId = process.env.DFNS_ASSET_ISSUER_WALLET_ID;
  if (!issuerWalletId) throw new Error('DFNS_ASSET_ISSUER_WALLET_ID is not set');

  const escrowWalletId = process.env.DFNS_ASSET_ESCROW_WALLET_ID;
  if (!escrowWalletId) throw new Error('DFNS_ASSET_ESCROW_WALLET_ID is not set');

  const omnibusWalletId = process.env.DFNS_OMNIBUS_WALLET_ID || undefined;

  const keySigner = new AsymmetricKeySigner({ credId: dfnsCredId, privateKey: dfnsPrivateKey });
  const dfnsClient = new DfnsApiClient({ baseUrl: dfnsBaseUrl, orgId: dfnsOrgId, authToken: dfnsAuthToken, signer: keySigner });
  const { signer } = await createDfnsEthersProvider({ dfnsClient, walletId: issuerWalletId, rpcUrl });

  let gasFunding: DfnsAppConfig['gasFunding'] = undefined
  const fundingWalletId = process.env.DFNS_GAS_FUNDING_WALLET_ID
  const fundingAmount = process.env.DFNS_GAS_FUNDING_AMOUNT
  if (fundingWalletId !== undefined && fundingAmount !== undefined) {
    gasFunding = { walletId: fundingWalletId, amount: fundingAmount }
  }

  return {
    type: 'dfns',
    orgId,
    provider,
    signer,
    finP2PClient: undefined,
    proofProvider: undefined,
    dfnsBaseUrl,
    dfnsOrgId,
    dfnsAuthToken,
    dfnsCredId,
    dfnsPrivateKey,
    rpcUrl,
    assetIssuerWalletId: issuerWalletId,
    assetEscrowWalletId: escrowWalletId,
    omnibusWalletId,
    gasFunding,
  };
}
