import { NetworkAccount } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { CustodyProvider } from '../custody/custody-provider';
import { AccountResolver, ResolvedAccount } from './account-resolver';

/** `pg.Pool#query`, narrowed to what this resolver needs, so tests can stand in for it. */
export type NetworkAccountQuery = (sql: string, params: unknown[]) => Promise<{ rows: { fin_id: string; account: NetworkAccount }[] }>;

/**
 * Resolves investors from what the router onboarded — the skeleton's
 * `network_accounts` table — instead of the adapter's own account mapping.
 *
 * A binding is per (organization, asset, finId) while an operation that needs
 * a lookup knows only the finId, so every binding of the finId is read: they
 * must agree on one account, and disagreement is reported rather than guessed
 * at. A custodial binding carries the custody account id the mapping used to
 * hold; its address comes from the custody provider.
 */
export class OnboardedAccountResolver implements AccountResolver {

  constructor(
    private readonly query: NetworkAccountQuery,
    private readonly schema: string,
    private readonly custodyProvider: CustodyProvider | undefined,
  ) {}

  async resolveAccount(finId: string): Promise<string | undefined> {
    return (await this.resolveFullAccount(finId))?.ledgerAccountId;
  }

  async resolveFullAccount(finId: string): Promise<ResolvedAccount | undefined> {
    const { rows } = await this.query(`SELECT fin_id, account FROM ${this.schema}.network_accounts WHERE fin_id = $1`, [finId]);
    const accounts = new Map<string, ResolvedAccount>();
    for (const row of rows) {
      const resolved = await this.toResolved(row.account);
      if (resolved) accounts.set(`${resolved.ledgerAccountId.toLowerCase()}|${resolved.custodyAccountId ?? ''}`, resolved);
    }
    if (accounts.size > 1) {
      throw new Error(`investor ${finId} is onboarded with ${accounts.size} different accounts; an operation cannot tell which one it means`);
    }
    return accounts.values().next().value;
  }

  async resolveFinId(account: string): Promise<string | undefined> {
    const { rows } = await this.query(
      `SELECT fin_id, account FROM ${this.schema}.network_accounts WHERE lower(account->>'address') = lower($1)`, [account]);
    const finIds = new Set(rows.map(r => r.fin_id));
    return finIds.size === 1 ? [...finIds][0] : undefined;
  }

  private async toResolved(account: NetworkAccount): Promise<ResolvedAccount | undefined> {
    switch (account.type) {
      case 'walletAccount':
      case 'caip10Account':
        return { ledgerAccountId: account.address };
      case 'custodialAccount': {
        if (!this.custodyProvider?.resolveAddressFromCustodyId) {
          throw new Error(`custodial account ${account.vaultAccountId} cannot be resolved: the custody provider cannot map custody account ids to addresses`);
        }
        return { ledgerAccountId: await this.custodyProvider.resolveAddressFromCustodyId(account.vaultAccountId), custodyAccountId: account.vaultAccountId };
      }
      default:
        return undefined;
    }
  }
}
