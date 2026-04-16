import { custodyRegistry } from "../../services/direct";
import { DfnsAppConfig } from "./config";
import { DfnsCustodyProvider } from "./provider";

export * from "./config";
export * from "./provider";

export function registerDfns(): void {
  custodyRegistry.register('dfns', (config) => DfnsCustodyProvider.create(config as DfnsAppConfig));
}
