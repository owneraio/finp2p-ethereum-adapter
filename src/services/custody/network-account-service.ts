import winston from 'winston';
import {
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  failedAccountOperation,
  successfulAccountOperation,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord, WhitelistParty, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { AssetStore } from '../accounts';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

/**
 * Investor onboarding for custody modes: plan approval only validates
 * whitelisting (isWhitelisted vetoes), so onboarding is where the investor's
 * wallet gets whitelisted on the asset's token standard — and offboarding is
 * where it gets dewhitelisted. Assets not kept in this adapter and standards
 * without the whitelisting capability bind/unbind as before.
 *
 * The whitelist runs after the binding is recorded: the SPI mutations are
 * idempotent, so a failed onboarding retried by the router replays the stored
 * binding and re-attempts the whitelist. In omnibus mode all investors share
 * one wallet, so removal must not dewhitelist it (dewhitelistOnRemove=false).
 */
export class CustodyNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly assetStore: AssetStore,
    private readonly logger: winston.Logger,
    private readonly dewhitelistOnRemove: boolean,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    const op = await super.createAccount(idempotencyKey, organizationId, assetId, finId, bindInfo);
    if (op.type !== 'success' || op.record.account.type !== 'walletAccount') return op;

    const failure = await this.mutate('whitelist', assetId, { finId, address: op.record.account.address, role: 'destination' });
    if (failure) {
      this.logger.error(`onboarding: whitelisting ${finId} (${op.record.account.address}) for asset ${assetId} failed: ${failure}`);
      return failedAccountOperation(op.correlationId, 1, `whitelisting investor ${finId} for asset ${assetId} failed: ${failure}`);
    }
    return op;
  }

  async removeAccount(idempotencyKey: string, accountId: string): Promise<AccountOperation> {
    const removed = await this.store.remove(accountId);
    if (removed && removed.account.type === 'walletAccount' && this.dewhitelistOnRemove) {
      const failure = await this.mutate('dewhitelist', removed.assetId, { finId: removed.finId, address: removed.account.address, role: 'destination' });
      if (failure) {
        // restore the binding so a retry reaches the dewhitelist again
        await this.store.insert(removed);
        this.logger.error(`offboarding: dewhitelisting ${removed.finId} (${removed.account.address}) for asset ${removed.assetId} failed: ${failure}`);
        return failedAccountOperation('', 1, `dewhitelisting investor ${removed.finId} for asset ${removed.assetId} failed: ${failure}`);
      }
    }
    return successfulAccountOperation('', { id: accountId, account: removed?.account ?? { type: 'none' } });
  }

  private async mutate(op: 'whitelist' | 'dewhitelist', assetId: string, party: WhitelistParty): Promise<string | undefined> {
    const dbAsset = await this.assetStore.getAsset(assetId);
    if (!dbAsset) return undefined; // asset is not kept in this adapter
    if (!tokenStandardRegistry.has(dbAsset.token_standard)) {
      return `token standard '${dbAsset.token_standard}' of asset ${assetId} is not registered`;
    }
    const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
    if (!supportsWhitelisting(standard)) return undefined;

    const asset: AssetRecord = {
      contractAddress: dbAsset.contract_address,
      decimals: dbAsset.decimals,
      tokenStandard: dbAsset.token_standard,
    };
    const result = await standard[op](asset, party, this.logger);
    return result.status === 'failure' ? result.reason : undefined;
  }
}
