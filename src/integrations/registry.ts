import winston from "winston";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { AssetStore, WalletResolver } from "../services/direct";
import { AccountModel } from "../config";
import { registerFireblocks } from "./fireblocks";
import { registerDfns } from "./dfns";
import { registerDtccPlugin } from "./dtcc";
import { registerDirectDeposit } from "./direct-deposit";

export interface IntegrationContext {
  orgId: string;
  logger: winston.Logger;
  pluginManager: PluginManager;
  finP2PClient: FinP2PClient;
  walletResolver: WalletResolver | undefined;
  rpcUrl: string | undefined;
  assetStore: AssetStore | undefined;
  accountModel: AccountModel;
}

export type IntegrationRegistrar = (ctx: IntegrationContext) => void;

/** Register compiled-in custody providers — must run before custodyRegistry.create(). */
export function registerCustodyIntegrations(): void {
  registerFireblocks();
  registerDfns();
}

const integrations: IntegrationRegistrar[] = [
  registerDirectDeposit,
  registerDtccPlugin,
];

/** Register runtime integrations (plugins, token standards) — runs after custody provider is created. */
export function registerIntegrations(ctx: IntegrationContext): void {
  for (const register of integrations) register(ctx);
}
