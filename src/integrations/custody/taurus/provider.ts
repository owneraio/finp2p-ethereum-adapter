import { JsonRpcProvider, Provider } from 'ethers';
import { CustodyProvider, CustodyWallet } from '../../../services/custody';
import { ChainReadScope } from '../../../services/custody/custody-provider';
import { getNetworkRpcUrl } from '../../../network-host';
import { TaurusAppConfig } from './config';
import { TaurusClient } from './client';
import { TaurusSigner } from './signers/base';
import { TaurusContractCallSigner } from './signers/contract-call';
import { TaurusTransferOnlySigner } from './signers/transfer-only';
import { TaurusChainProvider } from './chain-provider';

/**
 * Taurus-PROTECT/TDX custody provider (PoC). Custody account id = PROTECT
 * address id; keys live in the Taurus HSM and transactions run as governed
 * requests (see signer.ts for the structured-request translation the missing
 * raw signing forces). Addresses are cached at boot like the DFNS provider.
 */
export class TaurusCustodyProvider implements CustodyProvider {

  private constructor(
    private readonly config: TaurusAppConfig,
    private readonly client: TaurusClient,
    readonly chainReads: { provider: Provider; scope: ChainReadScope },
    private readonly addressToId: Map<string, string>,
  ) {}

  static async create(config: TaurusAppConfig): Promise<TaurusCustodyProvider> {
    const client = new TaurusClient(config);
    const chainReads = await TaurusCustodyProvider.chainReads(client, await client.getChainId(), config.requestPollIntervalMs);
    const addressToId = new Map<string, string>();
    for (const a of await client.listAddresses()) {
      if (a.address) addressToId.set(a.address.toLowerCase(), a.id);
    }
    return new TaurusCustodyProvider(config, client, chainReads, addressToId);
  }

  /** NETWORK_HOST when set (checked to be PROTECT's chain), otherwise PROTECT itself, which serves ERC20 reads only. */
  private static async chainReads(client: TaurusClient, chainId: bigint, pollingInterval: number): Promise<{ provider: Provider; scope: ChainReadScope }> {
    if (!process.env.NETWORK_HOST) return { provider: new TaurusChainProvider(client, chainId, pollingInterval), scope: 'erc20' };
    const rpc = new JsonRpcProvider(getNetworkRpcUrl());
    const rpcChainId = (await rpc.getNetwork()).chainId;
    if (rpcChainId !== chainId) {
      rpc.destroy();
      throw new Error(`NETWORK_HOST is on chain ${rpcChainId}, but Taurus PROTECT operates ${client.scope} on chain ${chainId}`);
    }
    return { provider: rpc, scope: 'full' };
  }

  async resolveWallet(account: string): Promise<CustodyWallet | undefined> {
    const addressId = this.addressToId.get(account.toLowerCase());
    if (!addressId) return undefined;
    return this.wallet(addressId, account);
  }

  async createWalletForCustodyId(custodyAccountId: string): Promise<CustodyWallet> {
    const address = await this.client.getAddress(custodyAccountId);
    return this.wallet(custodyAccountId, address.address);
  }

  async resolveAddressFromCustodyId(custodyAccountId: string): Promise<string> {
    const address = await this.client.getAddress(custodyAccountId);
    if (!address.address) throw new Error(`Taurus address ${custodyAccountId} has no chain address`);
    return address.address;
  }

  private wallet(addressId: string, address: string): CustodyWallet {
    const signer: TaurusSigner = this.config.operationMode === 'contract-call'
      ? new TaurusContractCallSigner(this.chainReads.provider, this.client, this.config, addressId, address)
      : new TaurusTransferOnlySigner(this.chainReads.provider, this.client, this.config, addressId, address);
    return { provider: this.chainReads.provider, signer };
  }
}
