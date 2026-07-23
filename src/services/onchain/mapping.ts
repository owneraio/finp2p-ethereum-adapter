import { AccountMappingService, AccountMapping, ReceiptOperation, Asset, ExecutionContext } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract, ReceiptOperation as ContractReceiptOperation } from '@owneraio/finp2p-ethereum-orchestrator';
import { FIELD_LEDGER_ACCOUNT_ID } from '../accounts/mapping-validator';

function mapAccount(acc: { finId: string; account?: string } | undefined) {
  if (!acc || !acc.finId) return undefined;
  return { finId: acc.finId, account: acc.account ? { type: 'ledger', address: acc.account } : undefined };
}

const hasRealPlan = (ctx: { planId?: string } | undefined | null): boolean =>
  !!ctx && typeof ctx.planId === 'string' && ctx.planId.trim().length > 0;

/**
 * Map a contracts ReceiptOperation to the skeleton's shape.
 * Optionally overrides the receipt's asset with the caller's full asset
 * (which carries ledgerIdentifier the on-chain contract doesn't know about).
 *
 * Reconstructs `tradeDetails.executionContext`: on-chain event logs carry no
 * FinP2P execution context, so finp2p-contracts seeds the parsed receipt with
 * `{ planId: "", sequence: 0 }`. The real context is captured at submission
 * time (passed here as `executionContext`, either the live value or one looked
 * up from the ExecDetailsStore by tx hash) and reinstated so the receipt can be
 * correlated back to its execution plan. When no real context is available the
 * empty placeholder is stripped — the router rejects empty `executionPlanId`.
 */
export function mapReceiptOperation(op: ContractReceiptOperation, asset?: Asset, executionContext?: ExecutionContext): ReceiptOperation {
  if (op.type !== 'success') return op as any;
  const rawTradeDetails = (op.receipt as any).tradeDetails;
  const rawExCtx = rawTradeDetails?.executionContext;
  const resolvedExCtx = hasRealPlan(executionContext)
    ? executionContext
    : hasRealPlan(rawExCtx)
      ? rawExCtx
      : undefined;
  const tradeDetails = rawTradeDetails
    ? { ...rawTradeDetails, executionContext: resolvedExCtx }
    : resolvedExCtx
      ? { executionContext: resolvedExCtx }
      : undefined;
  return {
    ...op,
    receipt: {
      ...op.receipt,
      asset: asset ?? op.receipt.asset,
      source: mapAccount(op.receipt.source as any),
      destination: mapAccount(op.receipt.destination as any),
      tradeDetails,
    },
  } as any;
}

/**
 * AccountMappingService backed by the on-chain credentials registry.
 * The contract is the source of truth — no DB persistence needed.
 */
export class CredentialsMappingService implements AccountMappingService {

  constructor(private readonly finP2PContract: FinP2PContract) {}

  async getAccounts(finIds?: string[]): Promise<AccountMapping[]> {
    if (!finIds || finIds.length === 0) return [];
    const results: AccountMapping[] = [];
    for (const finId of finIds) {
      try {
        const address = await this.finP2PContract.getCredentialAddress(finId);
        results.push({ finId, fields: { [FIELD_LEDGER_ACCOUNT_ID]: address } });
      } catch {
        // credential not found — skip
      }
    }
    return results;
  }

  async getByFieldValue(fieldName: string, value: string): Promise<AccountMapping[]> {
    // On-chain registry only supports lookup by finId, not by field value
    return [];
  }

  async saveAccount(finId: string, fields: Record<string, string>): Promise<AccountMapping> {
    const address = fields[FIELD_LEDGER_ACCOUNT_ID];
    if (!address) throw new Error(`Field '${FIELD_LEDGER_ACCOUNT_ID}' is required for on-chain credential mapping`);
    await this.finP2PContract.addCredential(finId, address);
    return { finId, fields };
  }

  async deleteAccount(finId: string, _fieldName?: string): Promise<void> {
    await this.finP2PContract.removeCredential(finId);
  }
}
