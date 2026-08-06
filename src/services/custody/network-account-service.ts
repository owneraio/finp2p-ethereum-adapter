import winston from 'winston';
import {
  AccountInvalidShapeError,
  AccountMappingServiceImpl,
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
import { FIELD_CUSTODY_ACCOUNT_ID, FIELD_LEDGER_ACCOUNT_ID } from '../accounts/mapping-validator';
import { CustodyProvider } from './custody-provider';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

const ETH_ADDRESS_FORMAT = /^0x[0-9a-fA-F]{40}$/;

/**
 * Investor onboarding for custody modes.
 *
 * Binding: a walletAccount address in EVM format binds as-is. Anything else is
 * treated as a custody account id (e.g. a Fireblocks vault account id) and
 * resolved to its wallet address via the custody provider — a temporary
 * overload until the skeleton's NetworkAccount union carries the spec's
 * custodialAccount variant. Either way the binding is mirrored into the
 * account-mapping store, which is what every operational resolver reads
 * (token services, plan approval, deposits); the custody account id is kept
 * on the mapping so per-operation signing skips the vault scan.
 *
 * Whitelisting: plan approval only validates (isWhitelisted vetoes), so
 * onboarding whitelists the investor's wallet on the asset's token standard
 * and offboarding dewhitelists it. Assets not kept in this adapter and
 * standards without the capability bind/unbind as before. The whitelist runs
 * after the binding is recorded: the SPI mutations are idempotent, so a failed
 * onboarding retried by the router replays the stored binding and re-attempts
 * the whitelist. In omnibus mode all investors share one wallet, so removal
 * must not dewhitelist it (dewhitelistOnRemove=false).
 */
export class CustodyNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly assetStore: AssetStore,
    private readonly custodyProvider: CustodyProvider | undefined,
    private readonly mappingService: AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
    private readonly dewhitelistOnRemove: boolean,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    let effectiveBind = bindInfo;
    let custodyAccountId: string | undefined;
    if (bindInfo?.account.type === 'walletAccount' && !ETH_ADDRESS_FORMAT.test(bindInfo.account.address)) {
      custodyAccountId = bindInfo.account.address;
      const address = await this.resolveCustodyAddress(custodyAccountId);
      this.logger.info(`onboarding: '${custodyAccountId}' taken as a custody account id, resolved to ${address}`);
      effectiveBind = { ...bindInfo, account: { type: 'walletAccount', address } };
    }

    const op = await super.createAccount(idempotencyKey, organizationId, assetId, finId, effectiveBind);
    if (op.type !== 'success' || op.record.account.type !== 'walletAccount') return op;
    const address = op.record.account.address;

    await this.mappingService.saveAccount(finId, custodyAccountId
      ? { [FIELD_LEDGER_ACCOUNT_ID]: address, [FIELD_CUSTODY_ACCOUNT_ID]: custodyAccountId }
      : { [FIELD_LEDGER_ACCOUNT_ID]: address });

    const failure = await this.mutate('whitelist', assetId, { finId, address, role: 'destination' });
    if (failure) {
      this.logger.error(`onboarding: whitelisting ${finId} (${address}) for asset ${assetId} failed: ${failure}`);
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
    // the account mapping is per finId and shared across the investor's asset
    // bindings, so unbinding one asset leaves it in place
    return successfulAccountOperation('', { id: accountId, account: removed?.account ?? { type: 'none' } });
  }

  private async resolveCustodyAddress(custodyAccountId: string): Promise<string> {
    if (!this.custodyProvider?.resolveAddressFromCustodyId) {
      throw new AccountInvalidShapeError(`'${custodyAccountId}' is not an EVM address and the custody provider cannot resolve custody account ids`);
    }
    try {
      return await this.custodyProvider.resolveAddressFromCustodyId(custodyAccountId);
    } catch (e) {
      throw new AccountInvalidShapeError(`cannot resolve custody account '${custodyAccountId}' to a wallet address: ${(e as Error).message}`);
    }
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
