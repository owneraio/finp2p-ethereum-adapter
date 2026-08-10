import winston from 'winston';
import {
  InvestorWhitelistEntry,
  InvestorWhitelistService,
  ValidationError,
  WhitelistParty,
  WhitelistRefusedError,
  storage,
  whitelistPartyId,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import {
  AssetRecord,
  InvestorWhitelisting,
  TokenStandard,
  WhitelistParty as SpiParty,
  supportsWhitelisting,
} from '@owneraio/finp2p-ethereum-adapter-contract';
import { AccountResolver, AssetStore } from './account-resolver';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

interface CapableAsset {
  id: string;
  record: AssetRecord;
  standard: TokenStandard & InvestorWhitelisting;
}

/**
 * Chain-backed InvestorWhitelistService: the token's own enforcement is the
 * source of truth and nothing is stored adapter-side. A finId party resolves
 * to its mapped wallet; an address party is used as-is (the escrow custody
 * wallet has no finId). A failure the standard reports is a refusal
 * (WhitelistRefusedError -> 409) — with a partial whitelisting policy that is
 * the intended "onboarding is incomplete elsewhere" signal — while thrown
 * faults stay 500s. getWhitelist can only report what the chain can tell it:
 * queries need a party, and config is never reconstructable.
 */
export class ChainInvestorWhitelistService implements InvestorWhitelistService {

  constructor(
    private readonly assetStore: AssetStore,
    private readonly listAssets: () => Promise<storage.Asset[]>,
    private readonly accountMapping: AccountResolver,
    private readonly logger: winston.Logger,
  ) {}

  async whitelist(party: WhitelistParty, assetId: string, config: Record<string, unknown>): Promise<InvestorWhitelistEntry> {
    const spiParty = await this.resolveParty(party, config);
    const asset = await this.capableAsset(assetId);
    const result = await asset.standard.whitelist(asset.record, spiParty, this.logger);
    if (result.status === 'failure') {
      throw new WhitelistRefusedError(`whitelisting ${whitelistPartyId(party)} for asset ${assetId} refused: ${result.reason}`);
    }
    this.logger.info(`whitelist: ${whitelistPartyId(party)} (${spiParty.address}) whitelisted for asset ${assetId}`);
    return { party, assetId, config };
  }

  async dewhitelist(party: WhitelistParty, assetId?: string): Promise<number> {
    const spiParty = await this.resolveParty(party, {});
    const assets = assetId ? [await this.capableAsset(assetId)] : await this.capableAssets();
    let removed = 0;
    for (const asset of assets) {
      if (!await asset.standard.isWhitelisted(asset.record, spiParty, this.logger)) continue;
      const result = await asset.standard.dewhitelist(asset.record, spiParty, this.logger);
      if (result.status === 'failure') {
        throw new WhitelistRefusedError(`dewhitelisting ${whitelistPartyId(party)} for asset ${asset.id} refused: ${result.reason}`);
      }
      removed += 1;
    }
    this.logger.info(`dewhitelist: ${whitelistPartyId(party)} (${spiParty.address}) removed from ${removed} asset(s)`);
    return removed;
  }

  async isWhitelisted(party: WhitelistParty, assetId: string): Promise<boolean> {
    const spiParty = await this.resolveParty(party, {});
    const asset = await this.capableAsset(assetId);
    return asset.standard.isWhitelisted(asset.record, spiParty, this.logger);
  }

  async getWhitelist(party?: WhitelistParty, assetId?: string): Promise<InvestorWhitelistEntry[]> {
    if (!party) return []; // the chain cannot enumerate parties
    const spiParty = await this.resolveParty(party, {});
    const assets = assetId ? [await this.capableAsset(assetId)] : await this.capableAssets();
    const entries: InvestorWhitelistEntry[] = [];
    for (const asset of assets) {
      if (await asset.standard.isWhitelisted(asset.record, spiParty, this.logger)) {
        entries.push({ party, assetId: asset.id, config: {} });
      }
    }
    return entries;
  }

  private async resolveParty(party: WhitelistParty, config: Record<string, unknown>): Promise<SpiParty> {
    const country = typeof config.country === 'number' ? { country: config.country } : {};
    if (party.type === 'address') {
      return { address: party.address, role: 'escrow', ...country } as SpiParty;
    }
    const address = await this.accountMapping.resolveAccount(party.finId);
    if (!address) {
      throw new ValidationError(`no address mapped for finId ${party.finId}`);
    }
    return { finId: party.finId, address, role: 'destination', ...country } as SpiParty;
  }

  private async capableAsset(assetId: string): Promise<CapableAsset> {
    const dbAsset = await this.assetStore.getAsset(assetId);
    if (!dbAsset) {
      throw new ValidationError(`asset ${assetId} is not kept in this adapter`);
    }
    const capable = this.toCapable(dbAsset);
    if (!capable) {
      throw new ValidationError(`token standard '${dbAsset.token_standard}' of asset ${assetId} has no whitelisting capability`);
    }
    return capable;
  }

  private async capableAssets(): Promise<CapableAsset[]> {
    const capable: CapableAsset[] = [];
    for (const dbAsset of await this.listAssets()) {
      const asset = this.toCapable(dbAsset);
      if (asset) capable.push(asset);
    }
    return capable;
  }

  private toCapable(dbAsset: Pick<storage.Asset, 'id' | 'contract_address' | 'decimals' | 'token_standard'>): CapableAsset | undefined {
    if (!tokenStandardRegistry.has(dbAsset.token_standard)) return undefined;
    const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
    if (!supportsWhitelisting(standard)) return undefined;
    return {
      id: dbAsset.id,
      standard,
      record: {
        contractAddress: dbAsset.contract_address,
        decimals: dbAsset.decimals,
        tokenStandard: dbAsset.token_standard,
      },
    };
  }
}
