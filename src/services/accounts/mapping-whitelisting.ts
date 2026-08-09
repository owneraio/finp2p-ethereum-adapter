import winston from 'winston';
import {
  AccountMappingService,
  AccountMappingServiceImpl,
  AccountMappingValidator,
  ValidationError,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord, InvestorWhitelisting, TokenStandard, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

/** Replaced wallet awaiting dewhitelist, persisted on the mapping row itself
 *  so the cleanup intent survives restarts. */
export const FIELD_STALE_LEDGER_ACCOUNT_ID = 'staleLedgerAccountId';

interface CapableAsset {
  id: string;
  record: AssetRecord;
  standard: TokenStandard & InvestorWhitelisting;
}

/**
 * Keeps token-standard whitelisting in step with the internal mapping API,
 * which carries no asset context (a mapping is per finId), so every mutation
 * spans the stored whitelisting-capable assets. All entry points serialize
 * per finId. Integration points:
 *
 * - validate (pre-persist): the mapped wallet is whitelisted on every capable
 *   asset. isWhitelisted is checked first and only actual transitions are
 *   recorded, so a mid-sequence rollback never revokes authorization that
 *   predated the request. A replacement is recorded as staleLedgerAccountId
 *   in the fields being saved — a durable cleanup intent, not process memory.
 * - afterSave (post-persist): the stale wallet from the SAVED row is
 *   dewhitelisted and the marker cleared; on failure or crash the marker
 *   survives and the next update (or the manual endpoint) retries.
 * - deleteAccount (deactivation): the wallet is dewhitelisted BEFORE the row
 *   is deleted; a mid-sequence failure re-whitelists this call's transitions
 *   and aborts the deactivation, so authorization stays whole and the retry
 *   still has the address on record.
 * - onAssetCreated: a new capable asset whitelists every mapped wallet
 *   (investors onboarded before the asset existed). Never fails the asset
 *   creation — the asset is already persisted; a blocked investor recovers by
 *   resubmitting the mapping, which whitelists across all assets.
 *
 * Wallets shared with another investor are never dewhitelisted.
 */
export class MappingWhitelisting {

  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly listAssets: () => Promise<storage.Asset[]>,
    private readonly mappingService: () => AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
  ) {}

  /** Validate-time arm; returns extra fields to persist with the mapping. */
  async whitelistMappedWallet(finId: string, address: string): Promise<Record<string, string>> {
    return this.withLock(finId, async () => {
      const existing = (await this.mappingService().getAccounts([finId]))[0]?.fields ?? {};
      const previous = existing[FIELD_LEDGER_ACCOUNT_ID];
      const leftoverStale = existing[FIELD_STALE_LEDGER_ACCOUNT_ID];
      if (leftoverStale && leftoverStale.toLowerCase() !== address.toLowerCase()) {
        // a crashed earlier replacement never got cleaned — retry it now
        await this.dewhitelistEverywhere(finId, leftoverStale, 'stale-marker retry');
      }

      const transitions: CapableAsset[] = [];
      for (const asset of await this.capableAssets()) {
        const party = { finId, address, role: 'destination' as const };
        if (await asset.standard.isWhitelisted(asset.record, party, this.logger)) continue;
        const result = await asset.standard.whitelist(asset.record, party, this.logger);
        if (result.status === 'failure') {
          this.logger.error(`mapping: whitelisting ${finId} (${address}) for asset ${asset.id} failed: ${result.reason}`);
          await this.mutateAll(transitions, 'dewhitelist', finId, address, 'compensating rollback');
          throw new ValidationError(`whitelisting investor ${finId} for asset ${asset.id} failed: ${result.reason}`);
        }
        transitions.push(asset);
      }

      const markers: Record<string, string> = {};
      if (previous && previous.toLowerCase() !== address.toLowerCase()) {
        markers[FIELD_STALE_LEDGER_ACCOUNT_ID] = previous;
      }
      return markers;
    });
  }

  /** Post-save arm: consume the durable stale marker from the saved row. */
  async afterSave(finId: string): Promise<void> {
    return this.withLock(finId, async () => {
      const saved = (await this.mappingService().getAccounts([finId]))[0]?.fields;
      const stale = saved?.[FIELD_STALE_LEDGER_ACCOUNT_ID];
      if (!saved || !stale) return;
      const cleaned = await this.dewhitelistEverywhere(finId, stale, 'replaced-wallet cleanup');
      if (cleaned) {
        const { [FIELD_STALE_LEDGER_ACCOUNT_ID]: _, ...rest } = saved;
        await this.mappingService().saveAccount(finId, rest);
      }
    });
  }

  /** Deactivation arm: dewhitelist before the row is deleted; a failure
   *  re-whitelists this call's transitions and aborts the deactivation. */
  async beforeDelete(finId: string): Promise<void> {
    return this.withLock(finId, async () => {
      const fields = (await this.mappingService().getAccounts([finId]))[0]?.fields;
      const address = fields?.[FIELD_LEDGER_ACCOUNT_ID];
      if (!address || await this.sharedByOthers(finId, address)) return;

      const transitions: CapableAsset[] = [];
      for (const asset of await this.capableAssets()) {
        const party = { finId, address, role: 'destination' as const };
        if (!await asset.standard.isWhitelisted(asset.record, party, this.logger)) continue;
        const result = await asset.standard.dewhitelist(asset.record, party, this.logger);
        if (result.status === 'failure') {
          this.logger.error(`deactivation: dewhitelisting ${finId} (${address}) for asset ${asset.id} failed: ${result.reason}`);
          await this.mutateAll(transitions, 'whitelist', finId, address, 'deactivation rollback');
          throw new ValidationError(`dewhitelisting investor ${finId} for asset ${asset.id} failed: ${result.reason}`);
        }
        transitions.push(asset);
      }
    });
  }

  /** Never throws: the asset is already persisted when this runs; a blocked
   *  investor recovers by resubmitting the mapping. */
  async onAssetCreated(dbAsset: Pick<storage.Asset, 'id' | 'contract_address' | 'decimals' | 'token_standard'>): Promise<void> {
    try {
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
          this.logger.error(`asset ${dbAsset.id}: whitelisting mapped investor ${mapping.finId} (${address}) failed: ${result.reason} — resubmit the mapping or use /whitelisting/dewhitelist tooling`);
        }
      }
    } catch (e) {
      this.logger.error(`asset ${dbAsset.id}: whitelisting backfill failed: ${(e as Error).message} — mapped investors get whitelisted on their next mapping update`);
    }
  }

  /** @returns true when every capable asset was dewhitelisted */
  private async dewhitelistEverywhere(finId: string, address: string, context: string): Promise<boolean> {
    if (await this.sharedByOthers(finId, address)) return true;
    return this.mutateAll(await this.capableAssets(), 'dewhitelist', finId, address, context);
  }

  private async mutateAll(assets: CapableAsset[], op: 'whitelist' | 'dewhitelist', finId: string, address: string, context: string): Promise<boolean> {
    let allApplied = true;
    for (const asset of assets) {
      const result = await asset.standard[op](asset.record, { finId, address, role: 'destination' }, this.logger)
        .catch((e: Error) => ({ status: 'failure' as const, reason: e.message }));
      if (result.status === 'failure') {
        allApplied = false;
        this.logger.error(`mapping: ${op} of ${address} (${finId}) on asset ${asset.id} failed (${context}): ${result.reason}`);
      }
    }
    return allApplied;
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

  private withLock<T>(finId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(finId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(finId, next.catch(() => {}));
    return next;
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
    if (!address) return validated;
    const markers = await this.whitelisting.whitelistMappedWallet(finId, address);
    return { ...validated, ...markers };
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

/** Same dewhitelist-before-delete for mapping services this adapter does not
 *  own (the vanilla omnibus service) — delegation, since their class is not
 *  ours to extend. */
export function withDewhitelistOnDelete<T extends AccountMappingService>(service: T, whitelisting: MappingWhitelisting): T {
  return new Proxy(service, {
    get(target, prop, receiver) {
      if (prop === 'deleteAccount') {
        return async (finId: string, fieldName?: string) => {
          if (!fieldName) {
            await whitelisting.beforeDelete(finId);
          }
          return target.deleteAccount(finId, fieldName);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
