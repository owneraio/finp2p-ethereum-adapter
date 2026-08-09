import express from 'express';
import winston from 'winston';
import { AssetRecord, supportsWhitelisting } from '@owneraio/finp2p-ethereum-adapter-contract';
import { AccountResolver, AssetStore } from './account-resolver';
import { tokenStandardRegistry } from '../../integrations/token-standards/registry';

/**
 * Operational whitelisting endpoint for custody modes. Onboarding and the
 * mapping API whitelist automatically, but nothing internal removes an
 * investor from an asset's compliance registry on demand — deactivating a
 * mapping has no per-asset unbind semantics. POST /whitelisting/dewhitelist
 * with { assetId, finId } (address resolved via the account mapping) or
 * { assetId, address } is that escape hatch. Deliberately not gated by
 * ONBOARDING_WHITELISTING_ENABLED: it is an explicit operator action, and
 * the manual path matters most when the automatic mutations are off.
 */
export function registerWhitelistingRoutes(
  app: express.Application,
  assetStore: AssetStore,
  accountMapping: AccountResolver,
  logger: winston.Logger,
): void {
  app.post('/whitelisting/dewhitelist', async (req, res) => {
    try {
      const { assetId, finId, address: explicitAddress } = req.body ?? {};
      if (!assetId || (!finId && !explicitAddress)) {
        res.status(400).json({ error: 'assetId and one of finId or address are required' });
        return;
      }

      const dbAsset = await assetStore.getAsset(assetId);
      if (!dbAsset) {
        res.status(404).json({ error: `asset ${assetId} is not kept in this adapter` });
        return;
      }
      if (!tokenStandardRegistry.has(dbAsset.token_standard)) {
        res.status(400).json({ error: `token standard '${dbAsset.token_standard}' of asset ${assetId} is not registered` });
        return;
      }
      const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
      if (!supportsWhitelisting(standard)) {
        res.status(400).json({ error: `token standard '${dbAsset.token_standard}' has no whitelisting capability` });
        return;
      }

      const address = explicitAddress ?? await accountMapping.resolveAccount(finId);
      if (!address) {
        res.status(404).json({ error: `no address mapped for finId ${finId}` });
        return;
      }

      const asset: AssetRecord = {
        contractAddress: dbAsset.contract_address,
        decimals: dbAsset.decimals,
        tokenStandard: dbAsset.token_standard,
      };
      const result = await standard.dewhitelist(asset, { finId, address, role: 'destination' }, logger);
      if (result.status === 'failure') {
        logger.error(`dewhitelist: ${finId ?? ''} (${address}) for asset ${assetId} failed: ${result.reason}`);
        res.status(422).json({ status: 'failure', reason: result.reason });
        return;
      }
      logger.info(`dewhitelist: ${finId ?? ''} (${address}) removed from asset ${assetId}`);
      res.json({ status: 'success', assetId, address, transactionId: result.transactionId });
    } catch (e) {
      logger.error(`dewhitelist failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
