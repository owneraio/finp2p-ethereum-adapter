import { custodyRegistry } from "../../../services/custody";
import { getNetworkRpcUrl } from "../../../network-host";
import { pooledProvider } from "../../signer-pool";
import { createLocalCustodyConfig, requireDevChain } from "./config";
import { LocalCustodyProvider } from "./provider";

export * from "./config";
export * from "./provider";

export function registerLocal(): void {
  custodyRegistry.register('local', async () => {
    const config = createLocalCustodyConfig();
    const rpcUrl = getNetworkRpcUrl();
    await requireDevChain(pooledProvider(rpcUrl), config.extraDevChainIds);
    return new LocalCustodyProvider(config, rpcUrl);
  });
}
