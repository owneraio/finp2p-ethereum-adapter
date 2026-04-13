import { custodyRegistry } from "../../services/direct";
import { FireblocksAppConfig } from "./config";
import { FireblocksCustodyProvider } from "./provider";

export * from "./config";
export * from "./provider";
export * from "./raw-signer";

export function registerFireblocks(): void {
  custodyRegistry.register('fireblocks', (config) => FireblocksCustodyProvider.create(config as FireblocksAppConfig));
}
