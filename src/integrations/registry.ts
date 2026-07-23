import winston from "winston";
import { Provider } from "ethers";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { InboundTransferHook } from "@owneraio/finp2p-nodejs-skeleton-adapter/plugin";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-ethereum-orchestrator";
import { CustodyProvider, CustodyWallet } from "../services/custody";
import { GasStation } from "../services/funding";
import { WalletResolver } from "./wallet-resolver";
import { AssetStore } from "../services/accounts";
import { AccountModel } from "../config";
import { registerFireblocks } from "./custody/fireblocks";
import { registerDfns } from "./custody/dfns";
import { registerDeposits } from "./deposits";
import { registerTokenStandards } from "./token-standards";

export interface IntegrationContext {
  orgId: string;
  logger: winston.Logger;
  pluginManager: PluginManager;
  finP2PClient: FinP2PClient;
  walletResolver: WalletResolver | undefined;
  rpcUrl: string | undefined;
  /** app-level read-only RPC provider (NETWORK_HOST or the custody transport) */
  readProvider: Provider | undefined;
  /** app-level gas station (GAS_FUNDING_* over a custody-fabricated wallet) */
  gasStation: GasStation | undefined;
  /** omnibus wallet fabricated from OMNIBUS_CUSTODY_ACCOUNT_ID (omnibus mode) */
  omnibusWallet: CustodyWallet | undefined;
  /** escrow wallet fabricated from ASSET_ESCROW_CUSTODY_ACCOUNT_ID (hold/release operator) */
  escrowWallet: CustodyWallet | undefined;
  assetStore: AssetStore | undefined;
  accountModel: AccountModel;
  custodyProvider: CustodyProvider | undefined;
  inboundTransferHook: InboundTransferHook | undefined;
  /** finp2p-contract mode only — present iff PROVIDER_TYPE=finp2p-contract. */
  finP2PContract: FinP2PContract | undefined;
}

export type IntegrationRegistrar = (ctx: IntegrationContext) => void;

/** Register compiled-in custody providers — must run before custodyRegistry.create(). */
export function registerCustodyIntegrations(): void {
  registerFireblocks();
  registerDfns();
}

const integrations: IntegrationRegistrar[] = [
  registerTokenStandards,
  registerDeposits,
];

/** Register runtime integrations (plugins, token standards) — runs after custody provider is created. */
export function registerIntegrations(ctx: IntegrationContext): void {
  for (const register of integrations) register(ctx);
}
