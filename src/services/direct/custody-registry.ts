import { CustodyProvider } from './custody-provider';

/**
 * Factory function that creates a CustodyProvider from provider-specific config.
 * Each custody module exports one of these.
 */
export type CustodyProviderFactory<TConfig = any> = (config: TConfig) => Promise<CustodyProvider>;

/**
 * Embedded registry for custody provider modules.
 *
 * Provides config-driven activation: the adapter ships with all compiled-in
 * providers and selects the active one based on PROVIDER_TYPE at boot time.
 *
 * Registration is explicit — the adapter's bootstrap code imports provider
 * modules and registers their factories. This works for both in-repo providers
 * and external packages:
 *
 *   // In-repo provider
 *   import { FireblocksCustodyProvider } from './fireblocks-provider';
 *   custodyRegistry.register('fireblocks', config => FireblocksCustodyProvider.create(config));
 *
 *   // External package
 *   import { BlockdaemonCustodyProvider } from '@owneraio/finp2p-custody-blockdaemon';
 *   custodyRegistry.register('blockdaemon', config => BlockdaemonCustodyProvider.create(config));
 */
class CustodyProviderRegistry {
  private factories = new Map<string, CustodyProviderFactory>();

  register(providerType: string, factory: CustodyProviderFactory): void {
    if (this.factories.has(providerType)) {
      throw new Error(`Custody provider '${providerType}' is already registered`);
    }
    this.factories.set(providerType, factory);
  }

  async create(providerType: string, config: any): Promise<CustodyProvider> {
    const factory = this.factories.get(providerType);
    if (!factory) {
      const available = Array.from(this.factories.keys()).join(', ');
      throw new Error(`Unknown custody provider type: '${providerType}'. Available: ${available}`);
    }
    return factory(config);
  }

  has(providerType: string): boolean {
    return this.factories.has(providerType);
  }

  get availableProviders(): string[] {
    return Array.from(this.factories.keys());
  }
}

/** Singleton registry — populated at bootstrap before the app starts. */
export const custodyRegistry = new CustodyProviderRegistry();
