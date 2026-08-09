import winston from 'winston';
import { AccountMappingServiceImpl, AccountMappingValidator, ValidationError, storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord, InvestorWhitelisting, TokenStandard, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

interface CapableAsset {
  id: string;
  record: AssetRecord;
  standard: TokenStandard & InvestorWhitelisting;
}

/**
 * Mapping-API counterpart of the onboarding whitelist step: the internal
 * /mapping/owners route carries no asset context, so the mapped wallet is
 * whitelisted on every stored asset whose token standard has the capability
 * (the SPI mutations are idempotent). Runs after the inner validator so a
 * custody account id is already resolved to its address.
 *
 * A whitelist failure rejects the mapping request before it persists, and the
 * assets already whitelisted in the same request are compensated by a
 * best-effort dewhitelist, so a rejected mapping does not leave the wallet
 * partially authorized. Replacing an investor's wallet dewhitelists the
 * previous address (best-effort, skipped when another investor maps the same
 * wallet) after the new one is fully authorized. Deactivation
 * (status=inactive) never reaches the validator, so it cannot dewhitelist —
 * that path is the manual /whitelisting/dewhitelist endpoint.
 */
export class WhitelistingMappingValidator implements AccountMappingValidator {

  constructor(
    private readonly inner: AccountMappingValidator | undefined,
    private readonly listAssets: () => Promise<storage.Asset[]>,
    private readonly mappingService: AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
  ) {}

  async validate(finId: string, fields: Record<string, string>): Promise<Record<string, string>> {
    const validated = this.inner ? await this.inner.validate(finId, fields) : fields;
    const address = validated[FIELD_LEDGER_ACCOUNT_ID];
    if (!address) return validated;

    const previousAddress = await this.replacedAddress(finId, address);
    const assets = await this.capableAssets();

    const whitelisted: CapableAsset[] = [];
    for (const asset of assets) {
      const result = await asset.standard.whitelist(asset.record, { finId, address, role: 'destination' }, this.logger);
      if (result.status === 'failure') {
        this.logger.error(`mapping: whitelisting ${finId} (${address}) for asset ${asset.id} failed: ${result.reason}`);
        await this.compensate(whitelisted, finId, address);
        throw new ValidationError(`whitelisting investor ${finId} for asset ${asset.id} failed: ${result.reason}`);
      }
      whitelisted.push(asset);
    }

    if (previousAddress) {
      await this.dewhitelistReplaced(assets, finId, previousAddress);
    }
    return validated;
  }

  /** The investor's currently mapped address when this request replaces it —
   *  undefined when unchanged or still mapped by another investor. */
  private async replacedAddress(finId: string, newAddress: string): Promise<string | undefined> {
    const existing = await this.mappingService.getAccounts([finId]);
    const previous = existing[0]?.fields?.[FIELD_LEDGER_ACCOUNT_ID];
    if (!previous || previous.toLowerCase() === newAddress.toLowerCase()) return undefined;
    const sharing = (await this.mappingService.getByFieldValue(FIELD_LEDGER_ACCOUNT_ID, previous))
      .filter(m => m.finId !== finId);
    if (sharing.length > 0) {
      this.logger.info(`mapping: replaced wallet ${previous} of ${finId} is mapped by ${sharing.length} other investor(s) — leaving it whitelisted`);
      return undefined;
    }
    return previous;
  }

  private async compensate(whitelisted: CapableAsset[], finId: string, address: string): Promise<void> {
    for (const asset of whitelisted) {
      const result = await asset.standard.dewhitelist(asset.record, { finId, address, role: 'destination' }, this.logger)
        .catch((e: Error) => ({ status: 'failure' as const, reason: e.message }));
      if (result.status === 'failure') {
        this.logger.error(`mapping: compensating dewhitelist of ${address} on asset ${asset.id} failed: ${result.reason} — the wallet stays authorized there`);
      }
    }
  }

  private async dewhitelistReplaced(assets: CapableAsset[], finId: string, previousAddress: string): Promise<void> {
    for (const asset of assets) {
      const result = await asset.standard.dewhitelist(asset.record, { finId, address: previousAddress, role: 'destination' }, this.logger)
        .catch((e: Error) => ({ status: 'failure' as const, reason: e.message }));
      if (result.status === 'failure') {
        this.logger.warn(`mapping: dewhitelisting replaced wallet ${previousAddress} of ${finId} on asset ${asset.id} failed: ${result.reason} — clean up via /whitelisting/dewhitelist`);
      }
    }
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
