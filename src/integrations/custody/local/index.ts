import { custodyRegistry } from "../../../services/custody";
import { createLocalCustodyConfig } from "./config";
import { LocalCustodyProvider } from "./provider";

export * from "./config";
export * from "./provider";

export function registerLocal(): void {
  custodyRegistry.register('local', async () => new LocalCustodyProvider(createLocalCustodyConfig()));
}
