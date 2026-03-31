import { BrowserProvider, Provider, Signer } from "ethers";
import { BaseAppConfig } from "../../config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadBuilderVaultProvider = () => require("@blockdaemon/buildervault-web3-provider");

export type BlockdaemonAppConfig = BaseAppConfig & {
  type: 'blockdaemon'
  rpcUrl: string
  masterKeyId: string
  assetIssuerAddressIndex: number
  assetEscrowAddressIndex: number
  omnibusAddressIndex?: number
  gasFunding?: {
    addressIndex: number
    amount: string
  }
}

export const createBlockdaemonEthersProvider = async (config: {
  rpcUrl: string
  masterKeyId: string
  accountId?: number
  addressIndex: number
}): Promise<{ provider: Provider; signer: Signer }> => {
  const mod = loadBuilderVaultProvider();
  const BuilderVaultProvider = mod.default || mod;

  const eip1193Provider = new BuilderVaultProvider({
    chains: [{ rpcUrl: config.rpcUrl }],
    masterKeyId: config.masterKeyId,
    accountId: config.accountId ?? 0,
    addressIndex: config.addressIndex,
  });

  const provider = new BrowserProvider(eip1193Provider);
  const signer = await provider.getSigner();
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

export async function createBlockdaemonAppConfig(): Promise<Omit<BlockdaemonAppConfig, 'accountMappingType' | 'accountModel'>> {
  const orgId = process.env.ORGANIZATION_ID || '';

  const rpcUrl = getNetworkRpcUrl();

  const masterKeyId = process.env.BLOCKDAEMON_MASTER_KEY_ID;
  if (!masterKeyId) throw new Error('BLOCKDAEMON_MASTER_KEY_ID is not set');

  const assetIssuerAddressIndex = parseInt(process.env.BLOCKDAEMON_ASSET_ISSUER_ADDRESS_INDEX || '0', 10);
  const assetEscrowAddressIndex = parseInt(process.env.BLOCKDAEMON_ASSET_ESCROW_ADDRESS_INDEX || '1', 10);

  const { provider, signer } = await createBlockdaemonEthersProvider({
    rpcUrl,
    masterKeyId,
    addressIndex: assetIssuerAddressIndex,
  });

  const omnibusAddressIndexStr = process.env.BLOCKDAEMON_OMNIBUS_ADDRESS_INDEX;
  const omnibusAddressIndex = omnibusAddressIndexStr !== undefined ? parseInt(omnibusAddressIndexStr, 10) : undefined;

  let gasFunding: BlockdaemonAppConfig['gasFunding'] = undefined;
  const fundingAddressIndexStr = process.env.BLOCKDAEMON_GAS_FUNDING_ADDRESS_INDEX;
  const fundingAmount = process.env.BLOCKDAEMON_GAS_FUNDING_AMOUNT;
  if (fundingAddressIndexStr !== undefined && fundingAmount !== undefined) {
    gasFunding = { addressIndex: parseInt(fundingAddressIndexStr, 10), amount: fundingAmount };
  }

  return {
    type: 'blockdaemon',
    orgId,
    provider,
    signer,
    finP2PClient: undefined,
    proofProvider: undefined,
    rpcUrl,
    masterKeyId,
    assetIssuerAddressIndex,
    assetEscrowAddressIndex,
    omnibusAddressIndex,
    gasFunding,
  };
}
