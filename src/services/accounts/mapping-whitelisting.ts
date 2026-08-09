import winston from 'winston';
import { AccountMappingValidator, ValidationError, storage } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { AssetRecord, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { FIELD_LEDGER_ACCOUNT_ID } from './mapping-validator';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

/**
 * Mapping-API counterpart of the onboarding whitelist step: the internal
 * /mapping/owners route carries no asset context, so the mapped wallet is
 * whitelisted on every stored asset whose token standard has the capability
 * (the SPI mutations are idempotent). Runs after the inner validator so a
 * custody account id is already resolved to its address; a whitelist failure
 * rejects the mapping request before anything persists. Deactivation
 * (status=inactive) never dewhitelists — the mapping API has no per-asset
 * unbind semantics.
 */
export class WhitelistingMappingValidator implements AccountMappingValidator {

  constructor(
    private readonly inner: AccountMappingValidator | undefined,
    private readonly listAssets: () => Promise<storage.Asset[]>,
    private readonly logger: winston.Logger,
  ) {}

  async validate(finId: string, fields: Record<string, string>): Promise<Record<string, string>> {
    const validated = this.inner ? await this.inner.validate(finId, fields) : fields;
    const address = validated[FIELD_LEDGER_ACCOUNT_ID];
    if (!address) return validated;

    for (const dbAsset of await this.listAssets()) {
      if (!tokenStandardRegistry.has(dbAsset.token_standard)) continue;
      const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
      if (!supportsWhitelisting(standard)) continue;

      const asset: AssetRecord = {
        contractAddress: dbAsset.contract_address,
        decimals: dbAsset.decimals,
        tokenStandard: dbAsset.token_standard,
      };
      const result = await standard.whitelist(asset, { finId, address, role: 'destination' }, this.logger);
      if (result.status === 'failure') {
        this.logger.error(`mapping: whitelisting ${finId} (${address}) for asset ${dbAsset.id} failed: ${result.reason}`);
        throw new ValidationError(`whitelisting investor ${finId} for asset ${dbAsset.id} failed: ${result.reason}`);
      }
    }
    return validated;
  }
}
