import { isAddress } from 'ethers';
import { WhitelistingConfig, WhitelistingMechanism, WhitelistingPolicy } from '@owneraio/finp2p-ethereum-hedera-plugin';

/**
 * HEDERA_ATS_WHITELISTING_MECHANISMS: comma-separated WhitelistingMechanism
 * names, granted in the given order; 'none' is exclusive; absent means the
 * standard discovers and operates every mechanism the token enforces. The
 * internal-kyc credential issuer is the asset issuer's address
 * (ASSET_ISSUER_PRIVATE_KEY) — one identity for minting and for issuing KYC
 * credentials; the remaining parameters keep the plugin defaults (all
 * referenced lists, unbounded credential validity). A typo fails the boot
 * rather than degrading to full discovery.
 */
export function parseAtsWhitelistingMechanisms(env: string | undefined, kycIssuerAddress: string | undefined): WhitelistingPolicy | undefined {
  if (env === undefined || env.trim() === '') return undefined;
  const valid = new Set<string>(Object.values(WhitelistingMechanism));
  const configs = env.split(',').map(s => s.trim()).filter(Boolean).map((name): WhitelistingConfig => {
    if (!valid.has(name)) {
      throw new Error(`HEDERA_ATS_WHITELISTING_MECHANISMS: unknown mechanism '${name}' — valid: ${[...valid].join(', ')}`);
    }
    const mechanism = name as WhitelistingMechanism;
    if (mechanism === WhitelistingMechanism.InternalKyc && kycIssuerAddress) {
      return { mechanism, issuer: kycIssuerAddress };
    }
    return { mechanism } as WhitelistingConfig;
  });
  if (configs.length === 0) return undefined;
  if (configs.some(c => c.mechanism === WhitelistingMechanism.None) && configs.length > 1) {
    throw new Error(`HEDERA_ATS_WHITELISTING_MECHANISMS: 'none' is exclusive and cannot be combined with other mechanisms`);
  }
  return configs.length === 1 ? configs[0] : configs;
}

/** HEDERA_ATS_FORMER_CONTROLLERS: comma-separated previous controller
 *  addresses, kept so holds signed before a controller rotation stay
 *  resolvable. */
export function parseFormerControllers(env: string | undefined): string[] {
  if (!env) return [];
  return env.split(',').map(s => s.trim()).filter(Boolean).map(address => {
    if (!isAddress(address)) {
      throw new Error(`HEDERA_ATS_FORMER_CONTROLLERS: '${address}' is not an EVM address`);
    }
    return address;
  });
}
