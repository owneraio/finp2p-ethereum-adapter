import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  ProofProvider,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  workflows,
  MappingConfig,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { CollateralDepositPlugin, CollateralPlanApprovalPlugin, CollateralTokenStandard, TokenStandardName as DTCC_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { createVanillaServices, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import {
  CredentialsMappingService,
  EscrowServiceImpl,
  ExecDetailsStore,
  TokenServiceImpl
} from "./services/finp2p-contract";
import { AppConfig, FinP2PContractAppConfig, getNetworkRpcUrl } from './config'
import {
  DirectTokenService,
  CustodyProvider,
  custodyRegistry,
  FireblocksCustodyProvider,
  FireblocksAppConfig,
  DfnsCustodyProvider,
  DfnsAppConfig,
  DerivationAccountMapping,
  DbAccountMapping,
  AccountMappingService,
  OmnibusDelegate,
  CommonServiceImpl as DirectCommonServiceImpl,
  HealthServiceImpl as DirectHealthServiceImpl,
} from "./services/direct"

// Register compiled-in custody providers
custodyRegistry.register('fireblocks', (config) => FireblocksCustodyProvider.create(config as FireblocksAppConfig));
custodyRegistry.register('dfns', (config) => DfnsCustodyProvider.create(config as DfnsAppConfig));

// Register built-in token standards
import { tokenStandardRegistry } from "./services/direct/token-standards/registry";
import { registerBuiltinTokenStandards } from "./services/direct/token-standards/register-builtins";
registerBuiltinTokenStandards();
import { CustodyMappingValidator, FIELD_CUSTODY_ACCOUNT_ID, FIELD_LEDGER_ACCOUNT_ID } from "./services/direct/mapping-validator";

function resolveAccountMapping(appConfig: AppConfig): AccountMappingService {
  switch (appConfig.accountMappingType) {
    case 'database':
      return new DbAccountMapping();
    case 'derivation':
    default:
      return new DerivationAccountMapping();
  }
}

function buildMappingConfig(custodyProvider?: CustodyProvider): MappingConfig {
  const fields = [
    { field: FIELD_LEDGER_ACCOUNT_ID, description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' },
  ];
  if (custodyProvider?.resolveAddressFromCustodyId) {
    fields.unshift({
      field: FIELD_CUSTODY_ACCOUNT_ID, description: 'Custody provider account ID (vault ID / wallet ID)', exampleValue: '85',
    });
  }
  return {
    fields,
    validator: custodyProvider ? new CustodyMappingValidator(custodyProvider) : undefined,
  };
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager, workflowsConfig: workflows.Config | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);

  if (appConfig.accountModel === 'omnibus') {
    if (!workflowsConfig?.storage) throw new Error('Workflows storage config is required for omnibus account model');
    const accountMapping = resolveAccountMapping(appConfig);
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping);
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      workflowsConfig.storage,
      logger,
    );
    // TODO(omnibus-inbound): use deterministic inbound idempotency key `${planId}:${instructionSequence}`
    // instead of request-scoped idempotency key to prevent duplicate credits on retried proposal callbacks.
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, workflowsConfig?.finP2PClient, inboundTransferHook);
    register(app, tokenService, escrowService, commonService, commonService, delegate, planApprovalService, pluginManager, workflowsConfig, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  const accountMapping = resolveAccountMapping(appConfig);
  const dbMapping = accountMapping instanceof DbAccountMapping ? accountMapping : undefined;
  const tokenService = new DirectTokenService(logger, custodyProvider, accountMapping);
  const commonService = new DirectCommonServiceImpl();
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, workflowsConfig?.finP2PClient);
  register(app, tokenService, tokenService, commonService, healthService, paymentsService, planApprovalService, pluginManager, workflowsConfig, mappingConfig, dbMapping);
}

async function createApp(
  workflowsConfig: workflows.Config | undefined,
  logger: winston.Logger,
  appConfig: AppConfig,
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

  const pluginManager = new PluginManager();
  let custodyProviderRef: CustodyProvider | undefined;

  // Runtime plugin activation: DTCC collateral
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') {
    const walletResolver = async (finId: string) => {
      const mappings = await workflows.getAccountMappings([finId]);
      if (mappings.length === 0) return undefined;
      const walletAddress = mappings[0].fields?.['ledgerAccountId'];
      const custodyAccountId = mappings[0].fields?.['custodyAccountId'];
      if (!walletAddress || !custodyAccountId) return undefined;
      if (!custodyProviderRef?.createWalletForCustodyId) return undefined;
      const wallet = await custodyProviderRef.createWalletForCustodyId(custodyAccountId);
      return { walletAddress, wallet };
    };

    const rpcUrl = getNetworkRpcUrl();
    tokenStandardRegistry.register(DTCC_TOKEN_STANDARD, new CollateralTokenStandard(process.env.FACTORY_ADDRESS ?? '', rpcUrl) as any);
    const depositPlugin = new CollateralDepositPlugin(
      appConfig.orgId, rpcUrl, workflowsConfig?.finP2PClient!, logger, walletResolver,
    );
    pluginManager.registerPaymentsPlugin(depositPlugin);

    const planApprovalPlugin = new CollateralPlanApprovalPlugin(
      rpcUrl, workflowsConfig?.finP2PClient!, logger, walletResolver,
    );
    pluginManager.registerPlanApprovalPlugin(planApprovalPlugin);

    logger.info(`DTCC plugin activated: token standard '${DTCC_TOKEN_STANDARD}', deposit + plan approval plugins registered`);
  }

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    const custodyProvider = await custodyRegistry.create(appConfig.type, appConfig);
    custodyProviderRef = custodyProvider; // wire lazy ref for plugin walletResolver
    registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, workflowsConfig);
  } else if (appConfig.type === 'finp2p-contract') {
    const contractConfig = appConfig as FinP2PContractAppConfig;
    if (contractConfig.accountModel === 'omnibus') {
      throw new Error('Omnibus account model is not supported with finp2p-contract provider');
    }
    const planApprovalService = new PlanApprovalServiceImpl(contractConfig.orgId, pluginManager, contractConfig.finP2PClient);
    const escrowService = new EscrowServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
    const tokenService = new TokenServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
    const mappingService = new CredentialsMappingService(contractConfig.finP2PContract);
    const mappingConfig = buildMappingConfig();
    register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig, mappingConfig, mappingService);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
