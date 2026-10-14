import { custodyRegistry } from '../../../services/custody';
import { ZodiaCustodyProvider } from './provider';
import { createZodiaAppConfig } from './config';

export { ZodiaCustodyProvider } from './provider';
export { ZodiaClient, ZodiaApiError, stableStringify } from './client';
export { ZodiaSigner, ZodiaApi, endToEndIdOf, instructionMismatch } from './signer';
export { ZodiaChainProvider } from './chain-provider';
export { ZodiaAppConfig, createZodiaAppConfig } from './config';

export function registerZodia(): void {
  custodyRegistry.register('zodia', async () => ZodiaCustodyProvider.create(createZodiaAppConfig()));
}
