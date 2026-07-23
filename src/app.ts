import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import { Provider } from "ethers";
import {
  register,
  PluginManager,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  AccountMappingServiceImpl,
  workflows,
  storage as storageModule,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { LedgerStorage, VanillaServiceImpl, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
import {
  CredentialsMappingService,
  OnChainTokenService,
} from "./services/onchain";
import {
  CustodyProvider,
  CustodyWallet,
  CustodyTokenService,
  custodyRegistry,
} from "./services/custody";
import { HealthServiceImpl } from "./services/network";
import { createWalletResolver } from "./integrations/wallet-resolver";
import {
  DbAccountResolver,
  AccountResolver,
  AccountMappingStore,
  AssetStore,
  buildMappingConfig,
} from "./services/accounts";
import { OmnibusDelegate } from "./services/omnibus";
import { GasStation } from "./services/funding";
import { CommonServiceImpl as DirectCommonServiceImpl } from "./services/operations";
import { registerCustodyIntegrations, registerIntegrations } from "./integrations/registry";
import { pooledProvider, pooledSigner } from "./integrations/signer-pool";
import { buildCustodyPlanApprovalService } from "./services/plan-approval";
import { AppConfig, FinP2PContractAppConfig, getNetworkRpcUrl } from "./config";

// Register compiled-in custody providers; token standards are registered per-network in registerIntegrations.
registerCustodyIntegrations();

export interface WorkflowsConfig {
  migration: workflows.MigrationConfig;
  finP2PClient?: FinP2PClient;
}

function wrapWithWorkflowProxy<T extends object>(
  service: T, workflowStorage: InstanceType<typeof workflows.WorkflowStorage> | undefined,
  finP2PClient: FinP2PClient | undefined, ...methods: (keyof T)[]
): T {
  if (!workflowStorage) return service;
  return workflows.createServiceProxy(() => Promise.resolve(), workflowStorage, finP2PClient, service, ...methods);
}

/**
 * Pre-built omnibus services. Created in createApp BEFORE registerIntegrations so the
 * inboundTransferHook can be threaded into the deposit plugins at construction time —
 * otherwise the plugins capture undefined and successful omnibus deposits silently fall
 * back to importTransactions only, never crediting the adapter's own omnibus ledger.
 */
interface OmnibusContext {
  delegate: OmnibusDelegate;
  vanilla: {
    tokenService: VanillaServiceImpl;
    escrowService: VanillaServiceImpl;
    commonService: VanillaServiceImpl;
    mappingService: VanillaServiceImpl;
    distributionService: VanillaServiceImpl;
    inboundTransferHook: VanillaServiceImpl;
  };
}

async function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, escrowWallet: CustodyWallet | undefined, readProvider: Provider | undefined, gasStation: GasStation | undefined, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbPool: any, finP2PClient: FinP2PClient | undefined,
  accountMappingStore: AccountMappingStore | undefined,
  accountMappingService: AccountMappingServiceImpl | undefined,
  assetStore: AssetStore | undefined,
  accountMapping: AccountResolver,
  omnibusCtx: OmnibusContext | undefined,
  ledgerSchema: string | undefined,
): Promise<void> {
  // Guard the shared preconditions up front, before anything touches the RPC
  // (HealthServiceImpl, the Hedera probe in buildCustodyPlanApprovalService): a
  // clear message beats a null-deref inside the probe.
  if (!readProvider) throw new Error('Read-only RPC provider is unavailable — set NETWORK_HOST or use a custody provider whose wallet exposes a transport');
  if (!escrowWallet) throw new Error('Escrow wallet is required for direct mode (set ASSET_ESCROW_CUSTODY_ACCOUNT_ID or OMNIBUS_CUSTODY_ACCOUNT_ID)');

  const healthService = new HealthServiceImpl(readProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool, ledgerSchema) : undefined;

  if (appConfig.accountModel === 'omnibus') {
    if (!omnibusCtx) throw new Error('Omnibus context not built — createVanillaServices must run before registerDirectServices');
    const { delegate, vanilla } = omnibusCtx;
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = vanilla;
    const planApprovalService = await buildCustodyPlanApprovalService(
      appConfig.orgId, finP2PClient,
      new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient, inboundTransferHook),
      gasStation, readProvider, accountMapping, assetStore!,
      // omnibus transactions sign from the omnibus wallet — never prefund investors
      { walletActivationAmount: process.env.WALLET_ACTIVATION_AMOUNT, investorPrefunding: false },
    );
    const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
    const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
    const proxiedEscrowService = wrapWithWorkflowProxy(escrowService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
    // When a PaymentsPlugin is registered (e.g. ota-deposit / pull-deposit), route deposits
    // through it so per-deposit ephemeral addresses, approval-watchers, and FinAPI receipt
    // export run. Otherwise fall back to the omnibus delegate's barebones "deposit to omnibus"
    // instruction, which has no plugin awareness.
    const paymentImpl = pluginManager.getPaymentsPlugin() !== null ? paymentsService : delegate;
    const proxiedPaymentService = wrapWithWorkflowProxy(paymentImpl, workflowStorage, finP2PClient, 'getDepositInstruction', 'payout');
    // vanilla-service's commonService.operationStatus unconditionally throws — async ops
    // persisted by the workflow proxy would be unreachable via /operations/status. Use the
    // workflow-storage-backed DirectCommonServiceImpl for that route, keep vanilla
    // commonService for liveness/readiness.
    const directCommonService = workflowStorage ? new DirectCommonServiceImpl(workflowStorage) : commonService;
    register(app, proxiedTokenService, proxiedEscrowService, directCommonService, commonService, proxiedPaymentService, proxiedPlanService, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  if (!assetStore || !dbPool || !accountMappingStore || !accountMappingService) throw new Error('DB connection is required for direct mode');
  // The issuer is the env-injected signer, never a custody wallet. Without a
  // persistent key, deploy/issue fail closed (a throwaway deployer would
  // strand every asset it creates); reads keep working.
  const assetIssuerKey = process.env.ASSET_ISSUER_PRIVATE_KEY;
  const networkHost = process.env.NETWORK_HOST;
  if (!assetIssuerKey) {
    logger.warn("ASSET_ISSUER_PRIVATE_KEY is not set — asset deployment and issuance are disabled");
  } else if (!networkHost) {
    logger.warn("NETWORK_HOST is not set — asset deployment and issuance are disabled");
  }
  // Same pooled provider/signer instances the token standards register with:
  // one NonceManager per key, plain NETWORK_HOST transport (the custody
  // transport may be a custody web3 provider, the wrong one for a raw env key).
  // Without NETWORK_HOST no standards register either, so there is nothing to issue.
  const issuerWallet = assetIssuerKey && networkHost
    ? { provider: readProvider, signer: pooledSigner(getNetworkRpcUrl(), assetIssuerKey) }
    : undefined;
  let tokenService: CustodyTokenService = new CustodyTokenService(logger, custodyProvider, escrowWallet, readProvider, accountMapping, assetStore, issuerWallet);
  const commonService = new DirectCommonServiceImpl(workflowStorage!);
  const planApprovalService = await buildCustodyPlanApprovalService(
    appConfig.orgId, finP2PClient,
    new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient),
    gasStation, readProvider, accountMapping, assetStore,
    { walletActivationAmount: process.env.WALLET_ACTIVATION_AMOUNT, investorPrefunding: true },
  );

  const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
  const proxiedEscrowService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
  const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
  const proxiedPaymentsService = wrapWithWorkflowProxy(paymentsService, workflowStorage, finP2PClient, 'getDepositInstruction', 'payout');
  register(app, proxiedTokenService, proxiedEscrowService, commonService, healthService, proxiedPaymentsService, proxiedPlanService, mappingConfig, accountMappingService);
}

function registerFinP2PContractServices(
  app: express.Application, contractConfig: FinP2PContractAppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbPool: any, finP2PClient: FinP2PClient | undefined,
  ledgerSchema: string | undefined,
) {
  if (contractConfig.accountModel === 'omnibus') {
    throw new Error('Omnibus account model is not supported with finp2p-contract provider');
  }
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool, ledgerSchema) : undefined;
  let planApprovalService = new PlanApprovalServiceImpl(contractConfig.orgId, pluginManager, contractConfig.finP2PClient);
  const tokenService = new OnChainTokenService(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager, contractConfig.defaultAssetStandard);
  const mappingService = new CredentialsMappingService(contractConfig.finP2PContract);
  const mappingConfig = buildMappingConfig();

  const commonService = workflowStorage ? new DirectCommonServiceImpl(workflowStorage) : tokenService;

  const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
  const proxiedEscrowService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
  const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
  register(app, proxiedTokenService, proxiedEscrowService, commonService, tokenService, paymentsService, proxiedPlanService, mappingConfig, mappingService);
}

async function createApp(
  workflowsConfig: WorkflowsConfig | undefined,
  logger: winston.Logger,
  appConfig: AppConfig,
  dbConnectionString?: string,
): Promise<express.Application> {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(expressLogger({
    winstonInstance: logger,
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === "/health/readiness" || req.url.toLowerCase() === "/health/liveness"
  }));

  // Run database migrations if configured
  if (workflowsConfig?.migration) {
    await workflows.migrateIfNeeded(workflowsConfig.migration);
  }

  const pluginManager = new PluginManager();
  const finP2PClient = workflowsConfig?.finP2PClient;

  // Postgres schema for skeleton tables — must match what migration created.
  // Read from migration config (preferred) or fall back to LEDGER_SCHEMA env var.
  const ledgerSchema = workflowsConfig?.migration?.schemaName || process.env.LEDGER_SCHEMA || undefined;

  // Shared data stores — decoupled from workflow storage
  const { Pool } = require('pg');
  const dbPool = dbConnectionString ? new Pool({ connectionString: dbConnectionString }) : undefined;
  dbPool?.on('error', () => {}); // Suppress pool errors during shutdown
  const accountMappingStore = dbPool ? new storageModule.PgAccountStore(dbPool, ledgerSchema) : undefined;
  const assetStore = dbPool ? new storageModule.PgAssetStore(dbPool, ledgerSchema) : undefined;

  let custodyProvider: CustodyProvider | undefined;
  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    custodyProvider = await custodyRegistry.create(appConfig.type, appConfig);
  }

  // Migration guard: the issuer moved from a custody vault
  // (ASSET_ISSUER_CUSTODY_ACCOUNT_ID) to an env private key
  // (ASSET_ISSUER_PRIVATE_KEY). An operator upgrading with the old shape would
  // otherwise boot healthy and fail every deploy/issue at runtime — surface it now.
  if (custodyProvider && process.env.ASSET_ISSUER_CUSTODY_ACCOUNT_ID && !process.env.ASSET_ISSUER_PRIVATE_KEY) {
    throw new Error('ASSET_ISSUER_CUSTODY_ACCOUNT_ID is set but ASSET_ISSUER_PRIVATE_KEY is not: issuance now uses the env private key (the custody-vault issuer was removed). Set ASSET_ISSUER_PRIVATE_KEY.');
  }

  // Role wallets are app-level composition: the custody provider only
  // fabricates a wallet for a given custody account id. Escrow signs
  // hold/release/escrow-redeem (falls back to the omnibus account).
  const escrowAccountId = (process.env.ASSET_ESCROW_CUSTODY_ACCOUNT_ID || undefined) ?? (process.env.OMNIBUS_CUSTODY_ACCOUNT_ID || undefined);
  const escrowWallet = custodyProvider && escrowAccountId && custodyProvider.createWalletForCustodyId
    ? await custodyProvider.createWalletForCustodyId(escrowAccountId)
    : undefined;

  // The adapter's single read-only RPC provider, decided once here: the plain
  // NETWORK_HOST endpoint when configured, otherwise the custody transport
  // (taken from a fabricated custody wallet). Everything downstream receives
  // this Provider and stays unaware of the choice.
  const readProvider: Provider | undefined = custodyProvider
    ? (process.env.NETWORK_HOST ? pooledProvider(getNetworkRpcUrl()) : escrowWallet?.provider)
    : undefined;

  // Gas funding is app-level composition too: the custody provider only
  // fabricates the wallet for the configured funding account.
  const gasFundingAccountId = process.env.GAS_FUNDING_CUSTODY_ACCOUNT_ID;
  const gasFundingAmount = process.env.GAS_FUNDING_AMOUNT;
  let gasStation: GasStation | undefined;
  if (custodyProvider && gasFundingAccountId && gasFundingAmount) {
    if (!custodyProvider.createWalletForCustodyId) {
      logger.warn('GAS_FUNDING_CUSTODY_ACCOUNT_ID is set but the custody provider cannot create wallets by custody id — gas funding disabled');
    } else {
      gasStation = new GasStation(await custodyProvider.createWalletForCustodyId(gasFundingAccountId), gasFundingAmount);
    }
  }

  // The omnibus wallet is app-level composition as well — fabricated from
  // OMNIBUS_CUSTODY_ACCOUNT_ID and handed to the omnibus services explicitly.
  const omnibusAccountId = process.env.OMNIBUS_CUSTODY_ACCOUNT_ID;
  const omnibusWallet = custodyProvider && omnibusAccountId && custodyProvider.createWalletForCustodyId
    ? await custodyProvider.createWalletForCustodyId(omnibusAccountId)
    : undefined;

  // Pre-build accountMapping + (in omnibus mode) the OmnibusDelegate and vanilla services
  // BEFORE plugin registration. Deposit plugins capture inboundTransferHook in their
  // constructors; if it's undefined at registration time they fall back to
  // finP2PClient.importTransactions only, skipping the vanilla hook's storage.credit(...)
  // and leaving the adapter's omnibus balance state stale.
  //
  // Skeleton 0.28.11+: caseSensitive=false makes the account-mapping service lowercase
  // FIELD_LEDGER_ACCOUNT_ID values on save and lookup, so EIP-55 checksummed and lowercase
  // EVM addresses resolve to the same record.
  const accountMappingService = accountMappingStore
    ? new AccountMappingServiceImpl(accountMappingStore, { caseSensitive: false })
    : undefined;
  if (!accountMappingService) {
    throw new Error('DB-backed account mapping is required (DB_CONNECTION_STRING must be set).');
  }
  const accountMapping: AccountResolver = new DbAccountResolver(accountMappingService);

  let omnibusCtx: OmnibusContext | undefined;
  if (appConfig.accountModel === 'omnibus' && custodyProvider) {
    if (!omnibusWallet) throw new Error('Omnibus account model requires OMNIBUS_CUSTODY_ACCOUNT_ID (and a custody provider able to create wallets by custody id)');
    if (!dbPool || !assetStore) throw new Error('DB connection is required for omnibus account model');
    const delegate = new OmnibusDelegate(logger, custodyProvider, omnibusWallet, escrowWallet!, readProvider!, gasStation, accountMapping, assetStore);
    // vanilla 0.28.2's createVanillaServices doesn't forward schemaName to its LedgerStorage,
    // so its account_mappings/accounts/transactions queries hit the default `ledger_adapter`
    // schema even when migrations placed those tables in `ethereum_adapter`. Build the storage
    // + service ourselves to pin the schema. (LedgerStorage + VanillaServiceImpl are public.)
    const ledgerStorage = new LedgerStorage(dbPool, ledgerSchema);
    const vanillaService = new VanillaServiceImpl(ledgerStorage, delegate, delegate, delegate, delegate, finP2PClient);
    omnibusCtx = {
      delegate,
      vanilla: {
        tokenService: vanillaService,
        escrowService: vanillaService,
        commonService: vanillaService,
        mappingService: vanillaService,
        distributionService: vanillaService,
        inboundTransferHook: vanillaService,
      },
    };
  }

  registerIntegrations({
    orgId: appConfig.orgId,
    logger,
    pluginManager,
    finP2PClient: finP2PClient!,
    walletResolver: custodyProvider && accountMappingStore ? createWalletResolver(accountMappingStore, custodyProvider) : undefined,
    rpcUrl: process.env.NETWORK_HOST ? getNetworkRpcUrl() : undefined,
    readProvider,
    gasStation,
    omnibusWallet,
    escrowWallet,
    assetStore,
    accountModel: appConfig.accountModel,
    custodyProvider,
    inboundTransferHook: omnibusCtx?.vanilla.inboundTransferHook,
    finP2PContract: appConfig.type === 'finp2p-contract' ? (appConfig as FinP2PContractAppConfig).finP2PContract : undefined,
  });

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyProvider) {
    await registerDirectServices(app, logger, custodyProvider, escrowWallet, readProvider, gasStation, appConfig, paymentsService, pluginManager, dbPool, finP2PClient, accountMappingStore, accountMappingService, assetStore, accountMapping, omnibusCtx, ledgerSchema);
  } else if (appConfig.type === 'finp2p-contract') {
    registerFinP2PContractServices(app, appConfig as FinP2PContractAppConfig, paymentsService, pluginManager, dbPool, finP2PClient, ledgerSchema);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
