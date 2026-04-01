import { AppConfig } from '../../config';
import { CustodyProvider } from './custody-provider';

/**
 * Factory function that creates a CustodyProvider from application config.
 * Each custody module registers one of these at boot time.
 */
export type CustodyProviderFactory = (appConfig: AppConfig) => Promise<CustodyProvider>;

/**
 * Embedded registry for custody provider modules.
 *
 * Provides config-driven activation: the adapter ships with all compiled-in
 * providers and selects the active one based on PROVIDER_TYPE at boot time.
 * No dynamic loading — all providers are statically imported and registered.
 */
class CustodyProviderRegistry {
  private factories = new Map<string, CustodyProviderFactory>();

  register(providerType: string, factory: CustodyProviderFactory): void {
    if (this.factories.has(providerType)) {
      throw new Error(`Custody provider '${providerType}' is already registered`);
    }
    this.factories.set(providerType, factory);
  }

  async create(providerType: string, appConfig: AppConfig): Promise<CustodyProvider> {
    const factory = this.factories.get(providerType);
    if (!factory) {
      const available = Array.from(this.factories.keys()).join(', ');
      throw new Error(`Unknown custody provider type: '${providerType}'. Available: ${available}`);
    }
    return factory(appConfig);
  }

  has(providerType: string): boolean {
    return this.factories.has(providerType);
  }

  get availableProviders(): string[] {
    return Array.from(this.factories.keys());
  }
}

/** Singleton registry — providers register themselves at import time. */
export const custodyRegistry = new CustodyProviderRegistry();
