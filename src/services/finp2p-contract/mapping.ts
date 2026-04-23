import { AccountMappingService, AccountMapping, ReceiptOperation, Asset } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract, ReceiptOperation as ContractReceiptOperation } from '@owneraio/finp2p-contracts';
import { FIELD_LEDGER_ACCOUNT_ID } from '../direct/mapping-validator';

function mapAccount(acc: { finId: string; account?: string } | undefined) {
  if (!acc) return undefined;
  return { finId: acc.finId, account: acc.account ? { type: 'ledger', address: acc.account } : undefined };
}

/**
 * Map a contracts ReceiptOperation to the skeleton's shape.
 * Optionally overrides the receipt's asset with the caller's full asset
 * (which carries ledgerIdentifier the on-chain contract doesn't know about).
 *
 * Strips an empty `tradeDetails.executionContext` — finp2p-contracts
 * seeds it with `{ planId: "", sequence: 0 }` when there's no real plan,
 * and the router rejects empty `executionPlanId` strings.
 */
export function mapReceiptOperation(op: ContractReceiptOperation, asset?: Asset): ReceiptOperation {
  if (op.type !== 'success') return op as any;
  const rawTradeDetails = (op.receipt as any).tradeDetails;
  const exCtx = rawTradeDetails?.executionContext;
  const hasRealExCtx = exCtx && typeof exCtx.planId === 'string' && exCtx.planId.trim().length > 0;
  const tradeDetails = hasRealExCtx
    ? rawTradeDetails
    : rawTradeDetails
      ? { ...rawTradeDetails, executionContext: undefined }
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
