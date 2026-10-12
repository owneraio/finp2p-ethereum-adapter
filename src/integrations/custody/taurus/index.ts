import { custodyRegistry } from '../../../services/custody';
import { TaurusCustodyProvider } from './provider';
import { createTaurusAppConfig } from './config';

export { TaurusCustodyProvider } from './provider';
export { TaurusClient } from './client';
export { TaurusSigner } from './signers/base';
export { TaurusContractCallSigner, decodeToContractCall } from './signers/contract-call';
export { TaurusTransferOnlySigner } from './signers/transfer-only';
export { TaurusAppConfig, createTaurusAppConfig } from './config';

export function registerTaurus(): void {
  custodyRegistry.register('taurus', async () => TaurusCustodyProvider.create(createTaurusAppConfig()));
}
