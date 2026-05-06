import winston from "winston";
import { AccountMappingStore } from "./account-mapping";
import { FIELD_LEDGER_ACCOUNT_ID, FIELD_CUSTODY_ACCOUNT_ID } from "./mapping-validator";
import { CustodyWallet } from "./custody-provider";

/**
 * Reserved finId placeholders for the adapter's own settlement accounts.
 * These don't correspond to real network finIds — they're keys under which
 * the adapter persists its env-derived omnibus / escrow addresses into
 * `account_mappings`, so runtime code can look them up via the same
 * AccountMappingService used for investor finIds (no env reads on the
 * read path; env stays load-bearing only at boot for signer construction).
 *
 * The `__omnibus__` value matches the constant vanilla-service uses
 * internally for its `accounts`-table balance accounting.
 */
export const OMNIBUS_FIN_ID = '__omnibus__';
export const ESCROW_FIN_ID = '__escrow__';

/**
 * Idempotently persist a special account's address (and optional custody
 * account ID) under a reserved finId. On address mismatch with the existing
 * entry, log a warning and overwrite — operators may legitimately rotate the
 * underlying custody account, but a silent change should be visible.
 */
export async function registerSpecialAccount(
  store: AccountMappingStore,
  reservedFinId: string,
  wallet: CustodyWallet,
  custodyAccountId: string | undefined,
  logger: winston.Logger,
): Promise<void> {
  const address = await wallet.signer.getAddress();
  const existing = await store.getAccounts([reservedFinId]);
  const existingAddress = existing[0]?.fields[FIELD_LEDGER_ACCOUNT_ID];
  if (existingAddress && existingAddress.toLowerCase() !== address.toLowerCase()) {
    logger.warn(`Special account '${reservedFinId}' address changed: was ${existingAddress}, now ${address} — overwriting mapping`);
  }
  const fields: Record<string, string> = { [FIELD_LEDGER_ACCOUNT_ID]: address };
  if (custodyAccountId) fields[FIELD_CUSTODY_ACCOUNT_ID] = custodyAccountId;
  await store.saveAccount(reservedFinId, fields);
  logger.info(`Registered special account '${reservedFinId}' → ${address}${custodyAccountId ? ` (custody: ${custodyAccountId})` : ''}`);
}
