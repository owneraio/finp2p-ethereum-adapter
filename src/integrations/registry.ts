import winston from "winston";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { WalletResolver } from "../services/direct";
import { registerFireblocks } from "./fireblocks";
import { registerDfns } from "./dfns";
import { registerDtccPlugin } from "./dtcc";

export interface IntegrationContext {
  orgId: string;
  logger: winston.Logger;
  pluginManager: PluginManager;
  finP2PClient: FinP2PClient;
  walletResolver: WalletResolver | undefined;
  rpcUrl: string;
}

export type IntegrationRegistrar = (ctx: IntegrationContext) => void;

/** Register compiled-in custody providers — must run before custodyRegistry.create(). */
export function registerCustodyIntegrations(): void {
  registerFireblocks();
  registerDfns();
}

const integrations: IntegrationRegistrar[] = [
  registerDtccPlugin,
];

/** Register runtime integrations (plugins, token standards) — runs after custody provider is created. */
export function registerIntegrations(ctx: IntegrationContext): void {
  for (const register of integrations) register(ctx);
}
