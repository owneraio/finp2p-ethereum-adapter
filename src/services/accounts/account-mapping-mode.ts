/**
 * Where an investor's account is looked up in custody modes. `disabled` (the
 * default): there is no account_mappings table and no internal /mapping
 * endpoints — investors resolve from what the router onboarded
 * (POST /accounts/create) and from the account on each operation leg.
 * `enabled` keeps the adapter's own finId→account mapping and its /mapping
 * endpoints, for deployments whose onboarding still seeds /mapping/owners and
 * for investors onboarded before router onboarding.
 *
 * On-chain (finp2p-contract) mode has no mapping table: its /mapping endpoints
 * read and write the operator contract's credentials registry and stay mounted.
 */
export type AccountMappingMode = 'enabled' | 'disabled'

export function resolveAccountMappingMode(rawValue: string | undefined): AccountMappingMode {
  if (!rawValue) return 'disabled';
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'enabled' || normalized === 'disabled') return normalized;
  throw new Error(`Invalid ACCOUNT_MAPPING: ${rawValue}. Supported values: enabled, disabled`);
}
