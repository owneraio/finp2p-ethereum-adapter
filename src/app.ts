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
import { register as registerDtcc } from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { createVanillaServices, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import {
  CredentialsMappingService,
  EscrowServiceImpl,
  ExecDetailsStore,
  TokenServiceImpl
} from "./services/finp2p-contract";
import { AppConfig, FinP2PContractAppConfig } from './config'
import {
  DirectTokenService,
  CustodyProvider,
  CustodyRoleBindings,
  CustodyWallet,
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
  app: express.Application, logger: winston.Logger,
  roles: CustodyRoleBindings<CustodyWallet>, custodyProvider: CustodyProvider,
  appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager, workflowsConfig: workflows.Config | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);

  if (appConfig.accountModel === 'omnibus') {
    if (!workflowsConfig?.storage) throw new Error('Workflows storage config is required for omnibus account model');
    const accountMapping = resolveAccountMapping(appConfig);
    const delegate = new OmnibusDelegate(logger, roles, custodyProvider, accountMapping);
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      workflowsConfig.storage,
      logger,
    );
    // TODO(omnibus-inbound): use deterministic inbound idempotency key `${planId}:${instructionSequence}`
    // instead of request-scoped idempotency key to prevent duplicate credits on retried proposal callbacks.
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient, inboundTransferHook);
    register(app, tokenService, escrowService, commonService, commonService, delegate, planApprovalService, pluginManager, workflowsConfig, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  const accountMapping = resolveAccountMapping(appConfig);
  const dbMapping = accountMapping instanceof DbAccountMapping ? accountMapping : undefined;
  const tokenService = new DirectTokenService(logger, roles, custodyProvider, accountMapping);
  const commonService = new DirectCommonServiceImpl();
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient);
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

  // Runtime plugin activation
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') {
    if (!workflowsConfig?.finP2PClient) {
      throw new Error('DTCC plugin requires finP2PClient in workflow config (set FINP2P_ADDRESS and OSS_URL)');
    }
    const contractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error('DTCC plugin requires FINP2P_CONTRACT_ADDRESS');
    }
    const finP2PContract = appConfig.type === 'finp2p-contract'
      ? (appConfig as FinP2PContractAppConfig).finP2PContract
      : new FinP2PContract(appConfig.provider, appConfig.signer, contractAddress, logger);
    await registerDtcc(pluginManager, finP2PContract, workflowsConfig.finP2PClient, appConfig.orgId, logger);
    logger.info('DTCC plugin activated');
  }

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    const { provider: custodyProvider, roles } = await custodyRegistry.create(appConfig.type, appConfig);
    registerDirectServices(app, logger, roles, custodyProvider, appConfig, paymentsService, pluginManager, workflowsConfig);
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
