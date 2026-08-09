import winston from 'winston';
import {
  AccountMappingServiceImpl,
  AccountMappingValidator,
  ValidationError,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord, InvestorWhitelisting, TokenStandard, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

interface CapableAsset {
  id: string;
  record: AssetRecord;
  standard: TokenStandard & InvestorWhitelisting;
}

/**
 * Keeps token-standard whitelisting in step with the internal mapping API,
 * which carries no asset context (a mapping is per finId), so every mutation
 * spans the stored whitelisting-capable assets. Four integration points:
 *
 * - validate (pre-persist): the mapped wallet is whitelisted on every capable
 *   asset. Only actual not-whitelisted -> whitelisted transitions are
 *   recorded, and on a mid-sequence failure exactly those are compensated —
 *   authorization that predated the request is never revoked. The failure
 *   rejects the mapping before it persists.
 * - afterSave (post-persist): a replaced wallet is dewhitelisted only after
 *   the new mapping is durably saved, so a storage failure cannot leave a
 *   persisted mapping with a revoked wallet. Dewhitelist failures are logged
 *   and left to the manual /whitelisting/dewhitelist endpoint.
 * - deleteAccount (deactivation): the wallet is dewhitelisted BEFORE the
 *   mapping row is deleted; a dewhitelist failure aborts the deactivation, so
 *   a retry still has the address on record. Wallets shared with another
 *   investor are never dewhitelisted.
 * - onAssetCreated: a new capable asset whitelists every mapped wallet, so
 *   investors onboarded before the asset existed are covered (failures are
 *   per-wallet logged, never failing the asset creation).
 */
export class MappingWhitelisting {

  /** replacement detected at validate time, consumed after the save */
  private readonly pendingReplacements = new Map<string, string>();

  constructor(
    private readonly listAssets: () => Promise<storage.Asset[]>,
    private readonly mappingService: () => AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
  ) {}

  async whitelistMappedWallet(finId: string, address: string): Promise<void> {
    this.pendingReplacements.delete(finId);
    const previous = await this.currentAddress(finId);
    if (previous && previous.toLowerCase() !== address.toLowerCase()) {
      this.pendingReplacements.set(finId, previous);
    }

    const transitions: CapableAsset[] = [];
    for (const asset of await this.capableAssets()) {
      const party = { finId, address, role: 'destination' as const };
      if (await asset.standard.isWhitelisted(asset.record, party, this.logger)) continue;
      const result = await asset.standard.whitelist(asset.record, party, this.logger);
      if (result.status === 'failure') {
        this.logger.error(`mapping: whitelisting ${finId} (${address}) for asset ${asset.id} failed: ${result.reason}`);
        await this.dewhitelist(transitions, finId, address, 'compensating rollback');
        throw new ValidationError(`whitelisting investor ${finId} for asset ${asset.id} failed: ${result.reason}`);
      }
      transitions.push(asset);
    }
  }

  async afterSave(finId: string): Promise<void> {
    const replaced = this.pendingReplacements.get(finId);
    if (!replaced) return;
    this.pendingReplacements.delete(finId);
    if (await this.sharedByOthers(finId, replaced)) return;
    await this.dewhitelist(await this.capableAssets(), finId, replaced, 'replaced-wallet cleanup — use /whitelisting/dewhitelist');
  }

  /** Dewhitelist-before-delete for deactivation; throwing aborts the deletion
   *  so a retry still has the address on record. */
  async beforeDelete(finId: string): Promise<void> {
    const address = await this.currentAddress(finId);
    if (!address || await this.sharedByOthers(finId, address)) return;
    for (const asset of await this.capableAssets()) {
      const party = { finId, address, role: 'destination' as const };
      if (!await asset.standard.isWhitelisted(asset.record, party, this.logger)) continue;
      const result = await asset.standard.dewhitelist(asset.record, party, this.logger);
      if (result.status === 'failure') {
        throw new ValidationError(`dewhitelisting investor ${finId} for asset ${asset.id} failed: ${result.reason}`);
      }
    }
  }

  async onAssetCreated(dbAsset: Pick<storage.Asset, 'id' | 'contract_address' | 'decimals' | 'token_standard'>): Promise<void> {
    if (!tokenStandardRegistry.has(dbAsset.token_standard)) return;
    const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
    if (!supportsWhitelisting(standard)) return;
    const record: AssetRecord = {
      contractAddress: dbAsset.contract_address,
      decimals: dbAsset.decimals,
      tokenStandard: dbAsset.token_standard,
    };
    for (const mapping of await this.mappingService().getAccounts()) {
      const address = mapping.fields?.[FIELD_LEDGER_ACCOUNT_ID];
      if (!address) continue;
      const result = await standard.whitelist(record, { finId: mapping.finId, address, role: 'destination' }, this.logger)
        .catch((e: Error) => ({ status: 'failure' as const, reason: e.message }));
      if (result.status === 'failure') {
        this.logger.error(`asset ${dbAsset.id}: whitelisting mapped investor ${mapping.finId} (${address}) failed: ${result.reason}`);
      }
    }
  }

  private async dewhitelist(assets: CapableAsset[], finId: string, address: string, context: string): Promise<void> {
    for (const asset of assets) {
      const result = await asset.standard.dewhitelist(asset.record, { finId, address, role: 'destination' }, this.logger)
        .catch((e: Error) => ({ status: 'failure' as const, reason: e.message }));
      if (result.status === 'failure') {
        this.logger.error(`mapping: dewhitelisting ${address} of ${finId} on asset ${asset.id} failed (${context}): ${result.reason}`);
      }
    }
  }

  private async currentAddress(finId: string): Promise<string | undefined> {
    const existing = await this.mappingService().getAccounts([finId]);
    return existing[0]?.fields?.[FIELD_LEDGER_ACCOUNT_ID];
  }

  private async sharedByOthers(finId: string, address: string): Promise<boolean> {
    const sharing = (await this.mappingService().getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, address))
      .filter(m => m.finId !== finId);
    if (sharing.length > 0) {
      this.logger.info(`mapping: wallet ${address} of ${finId} is mapped by ${sharing.length} other investor(s) — leaving it whitelisted`);
    }
    return sharing.length > 0;
  }

  private async capableAssets(): Promise<CapableAsset[]> {
    const capable: CapableAsset[] = [];
    for (const dbAsset of await this.listAssets()) {
      if (!tokenStandardRegistry.has(dbAsset.token_standard)) continue;
      const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
      if (!supportsWhitelisting(standard)) continue;
      capable.push({
        id: dbAsset.id,
        standard,
        record: {
          contractAddress: dbAsset.contract_address,
          decimals: dbAsset.decimals,
          tokenStandard: dbAsset.token_standard,
        },
      });
    }
    return capable;
  }
}

/** Pre-persist arm of MappingWhitelisting, chained after the custody validator. */
export class WhitelistingMappingValidator implements AccountMappingValidator {

  constructor(
    private readonly inner: AccountMappingValidator | undefined,
    private readonly whitelisting: MappingWhitelisting,
  ) {}

  async validate(finId: string, fields: Record<string, string>): Promise<Record<string, string>> {
    const validated = this.inner ? await this.inner.validate(finId, fields) : fields;
    const address = validated[FIELD_LEDGER_ACCOUNT_ID];
    if (address) {
      await this.whitelisting.whitelistMappedWallet(finId, address);
    }
    return validated;
  }
}

/** Deactivation arm: /mapping/owners with status=inactive deletes the mapping
 *  without running the validator or the hook, so the dewhitelist rides on the
 *  service call the route does make. */
export class WhitelistingAccountMappingService extends AccountMappingServiceImpl {

  private whitelisting?: MappingWhitelisting;

  attachWhitelisting(whitelisting: MappingWhitelisting): void {
    this.whitelisting = whitelisting;
  }

  async deleteAccount(finId: string, fieldName?: string): Promise<void> {
    if (!fieldName) {
      await this.whitelisting?.beforeDelete(finId);
    }
    return super.deleteAccount(finId, fieldName);
  }
}
