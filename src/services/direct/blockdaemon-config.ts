import { JsonRpcProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../config";
import { InstitutionalVaultClient } from "./blockdaemon/iv-client";
import { IVSigner } from "./blockdaemon/iv-signer";

export type BlockdaemonAppConfig = BaseAppConfig & {
  type: 'blockdaemon'
  ivClient: InstitutionalVaultClient
  ivApiUrl: string
  ivNetwork: string
  nativeAssetID: number
  assetIssuerAccountID: number
  assetEscrowAccountID: number
  omnibusAccountID?: number
  gasFunding?: {
    accountID: number
    amount: string
  }
}

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

/**
 * Resolve the Ethereum address for a given IV account.
 * Looks up the account's Ethereum assets and returns the first address on the
 * matching network.
 */
async function resolveAccountAddress(
  ivClient: InstitutionalVaultClient,
  accountID: number,
  network: string,
): Promise<string> {
  const account = await ivClient.getAccount(accountID);
  for (const aa of account.config.assets ?? []) {
    if (aa.asset.config.protocol !== 'ethereum') continue;
    if (aa.asset.config.network !== network) continue;
    for (const addr of aa.addresses) {
      if (addr.config.address) return addr.config.address;
    }
  }
  throw new Error(`No Ethereum/${network} address found for IV account ${accountID}`);
}

export async function createIVWallet(
  ivClient: InstitutionalVaultClient,
  accountID: number,
  nativeAssetID: number,
  network: string,
  rpcProvider: JsonRpcProvider,
): Promise<{ provider: Provider; signer: Signer }> {
  const address = await resolveAccountAddress(ivClient, accountID, network);
  const signer = new IVSigner(address, accountID, nativeAssetID, ivClient, rpcProvider);
  return { provider: rpcProvider, signer };
}

export async function createBlockdaemonAppConfig(): Promise<Omit<BlockdaemonAppConfig, 'accountMappingType' | 'accountModel'>> {
  const orgId = process.env.ORGANIZATION_ID || '';

  const ivApiUrl = process.env.BLOCKDAEMON_API_URL;
  if (!ivApiUrl) throw new Error('BLOCKDAEMON_API_URL is not set');

  const ivApiKey = process.env.BLOCKDAEMON_API_KEY;
  if (!ivApiKey) throw new Error('BLOCKDAEMON_API_KEY is not set');

  const ivNetwork = process.env.BLOCKDAEMON_NETWORK || 'hoodi';

  const nativeAssetID = parseInt(process.env.BLOCKDAEMON_NATIVE_ASSET_ID || '12', 10);

  const issuerAccountID = parseInt(process.env.BLOCKDAEMON_ASSET_ISSUER_ACCOUNT_ID || '', 10);
  if (isNaN(issuerAccountID)) throw new Error('BLOCKDAEMON_ASSET_ISSUER_ACCOUNT_ID is not set');

  const escrowAccountID = parseInt(process.env.BLOCKDAEMON_ASSET_ESCROW_ACCOUNT_ID || '', 10);
  if (isNaN(escrowAccountID)) throw new Error('BLOCKDAEMON_ASSET_ESCROW_ACCOUNT_ID is not set');

  const ivClient = new InstitutionalVaultClient(ivApiUrl, ivApiKey);
  const rpcUrl = getNetworkRpcUrl();
  const rpcProvider = new JsonRpcProvider(rpcUrl);

  const { provider, signer } = await createIVWallet(ivClient, issuerAccountID, nativeAssetID, ivNetwork, rpcProvider);

  const omnibusAccountIDStr = process.env.BLOCKDAEMON_OMNIBUS_ACCOUNT_ID;
  const omnibusAccountID = omnibusAccountIDStr ? parseInt(omnibusAccountIDStr, 10) : undefined;

  let gasFunding: BlockdaemonAppConfig['gasFunding'] = undefined;
  const fundingAccountIDStr = process.env.BLOCKDAEMON_GAS_FUNDING_ACCOUNT_ID;
  const fundingAmount = process.env.BLOCKDAEMON_GAS_FUNDING_AMOUNT;
  if (fundingAccountIDStr !== undefined && fundingAmount !== undefined) {
    gasFunding = { accountID: parseInt(fundingAccountIDStr, 10), amount: fundingAmount };
  }

  return {
    type: 'blockdaemon',
    orgId,
    provider,
    signer,
    finP2PClient: undefined,
    proofProvider: undefined,
    ivClient,
    ivApiUrl,
    ivNetwork,
    nativeAssetID,
    assetIssuerAccountID: issuerAccountID,
    assetEscrowAccountID: escrowAccountID,
    omnibusAccountID,
    gasFunding,
  };
}
