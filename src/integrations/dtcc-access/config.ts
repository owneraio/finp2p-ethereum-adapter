import winston from "winston";
import { DtccAccess, DtccAuthMode } from "./access";
import { IdentityClient, ServiceAccountCredentials } from "./identity";

const DEFAULT_MAX_DELEGATION_SECONDS = 8 * 3600;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when DTCC_IDT_ISSUER is set`);
  return value;
}

export interface DtccAccessConfig {
  access: DtccAccess;
  /** the AppChain's chain id; required in delegated mode, where nothing can be read before a user delegates */
  chainId?: bigint;
}

/** DTCC access from the environment; undefined when DTCC_IDT_ISSUER is not set. */
export function dtccAccessFromEnv(logger: winston.Logger): DtccAccessConfig | undefined {
  const issuer = process.env.DTCC_IDT_ISSUER;
  if (!issuer) return undefined;

  const modeEnv = process.env.DTCC_AUTH_MODE || 'service-account';
  if (modeEnv !== 'service-account' && modeEnv !== 'delegated') {
    throw new Error(`DTCC_AUTH_MODE must be service-account or delegated, got '${modeEnv}'`);
  }
  const mode: DtccAuthMode = modeEnv;

  const grant = process.env.DTCC_SA_GRANT || 'client_credentials';
  const clientId = required('DTCC_SA_CLIENT_ID');
  let credentials: ServiceAccountCredentials;
  if (grant === 'client_credentials') {
    const clientSecret = required('DTCC_SA_CLIENT_SECRET');
    credentials = { grant, clientId, clientSecret };
  } else if (grant === 'password') {
    const username = required('DTCC_SA_USERNAME');
    const password = required('DTCC_SA_PASSWORD');
    credentials = { grant, clientId, username, password };
  } else {
    throw new Error(`DTCC_SA_GRANT must be client_credentials or password, got '${grant}'`);
  }

  const maxDelegationEnv = process.env.DTCC_DELEGATION_MAX_SECONDS;
  const maxDelegationSeconds = maxDelegationEnv ? Number(maxDelegationEnv) : DEFAULT_MAX_DELEGATION_SECONDS;
  if (!Number.isInteger(maxDelegationSeconds) || maxDelegationSeconds <= 0) {
    throw new Error(`DTCC_DELEGATION_MAX_SECONDS must be a positive number of seconds, got '${maxDelegationEnv}'`);
  }
  const userAudience = process.env.DTCC_USER_AUDIENCE || undefined;

  const chainIdEnv = process.env.DTCC_CHAIN_ID;
  if (chainIdEnv && !/^\d+$/.test(chainIdEnv)) throw new Error(`DTCC_CHAIN_ID must be a decimal chain id, got '${chainIdEnv}'`);
  if (mode === 'delegated' && !chainIdEnv) {
    throw new Error('DTCC_CHAIN_ID is required in delegated mode: the chain cannot be read before a user delegates');
  }
  const chainId = chainIdEnv ? BigInt(chainIdEnv) : undefined;

  logger.info(`DTCC access: ${mode} mode, service account ${clientId} (${grant}) at ${issuer}`);
  const access = new DtccAccess(new IdentityClient(issuer, credentials), { mode, maxDelegationSeconds, userAudience, logger });
  return { access, chainId };
}
