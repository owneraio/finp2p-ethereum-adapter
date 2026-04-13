import winston from "winston";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { WalletResolver } from "../services/direct";
import { registerDtccPlugin } from "./dtcc";

export interface IntegrationContext {
  orgId: string;
  logger: winston.Logger;
  pluginManager: PluginManager;
  finP2PClient: FinP2PClient;
  walletResolver: WalletResolver;
  rpcUrl: string;
}

export type IntegrationRegistrar = (ctx: IntegrationContext) => void;

const integrations: IntegrationRegistrar[] = [
  registerDtccPlugin,
];

export function registerIntegrations(ctx: IntegrationContext): void {
  for (const register of integrations) register(ctx);
}
