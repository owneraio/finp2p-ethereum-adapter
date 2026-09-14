import { custodyRegistry } from '../../../services/custody';
import { TaurusCustodyProvider } from './provider';
import { createTaurusAppConfig } from './config';

export { TaurusCustodyProvider } from './provider';
export { TaurusClient } from './client';
export { TaurusSigner, TaurusContractCallSigner, TaurusTransferOnlySigner, decodeToContractCall } from './signer';
export { TaurusAppConfig, createTaurusAppConfig } from './config';

export function registerTaurus(): void {
  // the registry hands the app config through; the generic provider config
  // carries the resolved rpcUrl, everything else comes from TAURUS_* envs
  custodyRegistry.register('taurus', async (config: { rpcUrl: string }) => TaurusCustodyProvider.create(createTaurusAppConfig(config.rpcUrl)));
}
