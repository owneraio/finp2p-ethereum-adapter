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
 * Binding: a custodialAccount bind carries the custody account id (e.g. a
 * Fireblocks vault account id) explicitly and is resolved to its wallet
 * address via the custody provider; a walletAccount address in EVM format
 * binds as-is, and a walletAccount address in any other format is treated as
 * a custody account id too — a temporary overload kept until routers send
 * custodialAccount. Every binding is normalized to the resolved walletAccount
 * and mirrored into the account-mapping store, which is what every
 * operational resolver reads (token services, plan approval, deposits); the
 * custody account id is kept on the mapping so per-operation signing skips
 * the vault scan. The mapping is per finId and shared across the investor's
 * asset bindings, so unbinding leaves it in place.
 *
 * Whitelisting: plan approval only validates (isWhitelisted vetoes), so
 * onboarding whitelists the investor's wallet on the asset's token standard
 * and offboarding dewhitelists it — gated by whitelisting.enabled
 * (ONBOARDING_WHITELISTING_ENABLED; disabling leaves the mutations to an
 * external onboarding flow, plan approval keeps validating either way).
 * Assets not kept in this adapter and standards without the capability
 * bind/unbind as before.
 *
 * Ordering is chosen so every reported outcome is a consistent state — the
 * workflow proxy deduplicates by (method, inputs), so a failure with the same
 * idempotency key is terminal and must not strand half-applied work:
 * - create whitelists BEFORE persisting; a whitelist failure leaves nothing
 *   behind and remediation is a fresh onboarding request. Mid-crash the
 *   operation stays in_progress and crash recovery replays it end to end
 *   (the SPI mutations and the binding insert are idempotent).
 * - remove keeps the binding durable while dewhitelisting (peek by remove,
 *   restore, mutate, then delete); a shared wallet — another investor mapped
 *   to the same address — is never dewhitelisted.
 * In omnibus mode all investors share one wallet, so removal must not
 * dewhitelist it (dewhitelistOnRemove=false).
 */
export interface OnboardingWhitelistingOptions {
  enabled: boolean;
  dewhitelistOnRemove: boolean;
}

export class CustodyNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly assetStore: AssetStore,
    private readonly custodyProvider: CustodyProvider | undefined,
    private readonly mappingService: AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
    private readonly whitelisting: OnboardingWhitelistingOptions,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    let effectiveBind = bindInfo;
    let custodyAccountId: string | undefined;
    if (bindInfo?.account.type === 'custodialAccount') {
      custodyAccountId = bindInfo.account.vaultAccountId;
      const address = await this.resolveCustodyAddress(custodyAccountId);
      this.logger.info(`onboarding: custodial account ${custodyAccountId} (provider '${bindInfo.account.provider}') resolved to ${address}`);
      effectiveBind = { ...bindInfo, account: { type: 'walletAccount', address } };
    } else if (bindInfo?.account.type === 'walletAccount' && !ETH_ADDRESS_FORMAT.test(bindInfo.account.address)) {
      custodyAccountId = bindInfo.account.address;
      const address = await this.resolveCustodyAddress(custodyAccountId);
      this.logger.info(`onboarding: '${custodyAccountId}' taken as a custody account id, resolved to ${address}`);
      effectiveBind = { ...bindInfo, account: { type: 'walletAccount', address } };
    }

    if (effectiveBind?.account.type === 'walletAccount' && this.whitelisting.enabled) {
      await this.validator?.validate(effectiveBind.account);
      const { address } = effectiveBind.account;
      const failure = await this.mutate('whitelist', assetId, { finId, address, role: 'destination' });
      if (failure) {
        this.logger.error(`onboarding: whitelisting ${finId} (${address}) for asset ${assetId} failed: ${failure}`);
        return failedAccountOperation('', 1, `whitelisting investor ${finId} for asset ${assetId} failed: ${failure}`);
      }
    }

    const op = await super.createAccount(idempotencyKey, organizationId, assetId, finId, effectiveBind);
    if (op.type !== 'success' || op.record.account.type !== 'walletAccount') return op;
    const address = op.record.account.address;

    await this.mappingService.saveAccount(finId, custodyAccountId
      ? { [FIELD_LEDGER_ACCOUNT_ID]: address, [FIELD_CUSTODY_ACCOUNT_ID]: custodyAccountId }
      : { [FIELD_LEDGER_ACCOUNT_ID]: address });

    return op;
  }

  async removeAccount(idempotencyKey: string, accountId: string): Promise<AccountOperation> {
    const removed = await this.store.remove(accountId);
    if (!removed || removed.account.type !== 'walletAccount' || !this.whitelisting.enabled || !this.whitelisting.dewhitelistOnRemove) {
      return successfulAccountOperation('', { id: accountId, account: removed?.account ?? { type: 'none' } });
    }

    // keep the binding durable while the chain mutation runs; deleted only
    // after the dewhitelist succeeded, so a mid-crash replay re-attempts it
    await this.store.insert(removed);
    const { assetId, finId, account } = removed;

    const sharing = (await this.mappingService.getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, account.address))
      .filter(m => m.finId !== finId);
    if (sharing.length > 0) {
      this.logger.info(`offboarding: ${account.address} is mapped by ${sharing.length} other investor(s) — leaving it whitelisted`);
    } else {
      const failure = await this.mutate('dewhitelist', assetId, { finId, address: account.address, role: 'destination' });
      if (failure) {
        this.logger.error(`offboarding: dewhitelisting ${finId} (${account.address}) for asset ${assetId} failed: ${failure}`);
        return failedAccountOperation('', 1, `dewhitelisting investor ${finId} for asset ${assetId} failed: ${failure}`);
      }
    }

    await this.store.remove(accountId);
    return successfulAccountOperation('', { id: accountId, account });
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
