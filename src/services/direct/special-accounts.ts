import winston from "winston";
import { AccountMappingStore } from "./account-mapping";
import { FIELD_LEDGER_ACCOUNT_ID, FIELD_CUSTODY_ACCOUNT_ID } from "./mapping-validator";
import { CustodyProvider } from "./custody-provider";

/**
 * Reserved finId placeholders for the adapter's own settlement accounts.
 * These don't correspond to real network finIds — they're keys under which
 * the adapter persists its env-derived custody account IDs and addresses
 * into `account_mappings`, so runtime code can JIT-construct the relevant
 * signer via the same path used for investor finIds (no env reads on the
 * runtime path; env stays load-bearing only at boot for the seed write).
 *
 * The `__omnibus__` value matches the constant vanilla-service uses
 * internally for its `accounts`-table balance accounting.
 */
export const ISSUER_FIN_ID = '__issuer__';
export const ESCROW_FIN_ID = '__escrow__';
export const OMNIBUS_FIN_ID = '__omnibus__';

/**
 * Idempotently persist a special account's custody account ID and address
 * under a reserved finId. The address is resolved via
 * CustodyProvider.resolveAddressFromCustodyId — keeping providers as the
 * single authority for "what address backs this custody ID". On address
 * mismatch with the existing entry, log a warning and overwrite.
 */
export async function registerSpecialAccount(
  store: AccountMappingStore,
  reservedFinId: string,
  custodyAccountId: string,
  custodyProvider: CustodyProvider,
  logger: winston.Logger,
): Promise<void> {
  const address = await custodyProvider.resolveAddressFromCustodyId(custodyAccountId);
  const existing = await store.getAccounts([reservedFinId]);
  const existingAddress = existing[0]?.fields[FIELD_LEDGER_ACCOUNT_ID];
  if (existingAddress && existingAddress.toLowerCase() !== address.toLowerCase()) {
    logger.warn(`Special account '${reservedFinId}' address changed: was ${existingAddress}, now ${address} — overwriting mapping`);
  }
  await store.saveAccount(reservedFinId, {
    [FIELD_LEDGER_ACCOUNT_ID]: address,
    [FIELD_CUSTODY_ACCOUNT_ID]: custodyAccountId,
  });
  logger.info(`Registered special account '${reservedFinId}' → ${address} (custody: ${custodyAccountId})`);
}
