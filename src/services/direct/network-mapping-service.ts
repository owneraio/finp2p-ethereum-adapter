import { NetworkMappingService, NetworkMapping, workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';

/**
 * DB-backed network mapping service using skeleton's storage.
 */
export class DbNetworkMappingService implements NetworkMappingService {

  async getNetworkMappings(networkIds?: string[]): Promise<NetworkMapping[]> {
    return workflows.getNetworkMappings(networkIds);
  }

  async saveNetworkMapping(networkId: string, fields: Record<string, string>): Promise<NetworkMapping> {
    return workflows.saveNetworkMapping(networkId, fields);
  }

  async deleteNetworkMapping(networkId: string, fieldName?: string): Promise<void> {
    return workflows.deleteNetworkMapping(networkId, fieldName);
  }
}
