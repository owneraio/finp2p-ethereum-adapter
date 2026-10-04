/**
 * Where an investor's account is looked up. `enabled` (the default) keeps the
 * adapter's own finId→account mapping table and its internal /mapping
 * endpoints. `disabled` drops both: investors resolve from what the router
 * onboarded (POST /accounts/create) and from the account on each operation leg.
 */
export type AccountMappingMode = 'enabled' | 'disabled'

export function resolveAccountMappingMode(rawValue: string | undefined): AccountMappingMode {
  if (!rawValue) return 'enabled';
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'enabled' || normalized === 'disabled') return normalized;
  throw new Error(`Invalid ACCOUNT_MAPPING: ${rawValue}. Supported values: enabled, disabled`);
}
