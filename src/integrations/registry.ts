import winston from "winston";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { InboundTransferHook } from "@owneraio/finp2p-nodejs-skeleton-adapter/plugin";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { AssetStore, CustodyProvider, WalletResolver } from "../services/direct";
import { AccountModel } from "../config";
import { registerFireblocks } from "./fireblocks";
import { registerDfns } from "./dfns";
import { registerDtccPlugin } from "./dtcc";
import { registerWalletDeposit } from "./deposits/wallet-deposit";
import { registerPullDeposit } from "./deposits/pull-deposit";
import { registerOtaDeposit } from "./deposits/ota-deposit";

export interface IntegrationContext {
  orgId: string;
  logger: winston.Logger;
  pluginManager: PluginManager;
  finP2PClient: FinP2PClient;
  walletResolver: WalletResolver | undefined;
  rpcUrl: string | undefined;
  assetStore: AssetStore | undefined;
  accountModel: AccountModel;
  custodyProvider: CustodyProvider | undefined;
  inboundTransferHook: InboundTransferHook | undefined;
}

export type IntegrationRegistrar = (ctx: IntegrationContext) => void;

/** Register compiled-in custody providers — must run before custodyRegistry.create(). */
export function registerCustodyIntegrations(): void {
  registerFireblocks();
  registerDfns();
}

const integrations: IntegrationRegistrar[] = [
  registerWalletDeposit,
  registerPullDeposit,
  registerOtaDeposit,
  registerDtccPlugin,
];

/** Register runtime integrations (plugins, token standards) — runs after custody provider is created. */
export function registerIntegrations(ctx: IntegrationContext): void {
  for (const register of integrations) register(ctx);
}
