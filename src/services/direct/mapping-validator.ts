import { MappingValidator, ValidationError } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { isAddress } from 'ethers';
import { CustodyProvider } from './custody-provider';

export const FIELD_CUSTODY_ACCOUNT_ID = 'custodyAccountId';
export const FIELD_LEDGER_ACCOUNT_ID = 'ledgerAccountId';

/**
 * Validates and enriches account mappings before persistence.
 *
 * When custodyAccountId is provided, resolves the Ethereum address via the
 * custody provider and stores it as ledgerAccountId.
 * When ledgerAccountId is provided directly, validates it's a valid Ethereum address.
 */
export class CustodyMappingValidator implements MappingValidator {

  constructor(private readonly custodyProvider: CustodyProvider) {}

  async validate(finId: string, fields: Record<string, string>): Promise<Record<string, string>> {
    const custodyId = fields[FIELD_CUSTODY_ACCOUNT_ID];
    const ledgerAddress = fields[FIELD_LEDGER_ACCOUNT_ID];

    if (custodyId) {
      if (!this.custodyProvider.resolveAddressFromCustodyId) {
        throw new ValidationError('Custody provider does not support address resolution from custody account ID');
      }
      const resolved = await this.custodyProvider.resolveAddressFromCustodyId(custodyId);
      return {
        ...fields,
        [FIELD_CUSTODY_ACCOUNT_ID]: custodyId,
        [FIELD_LEDGER_ACCOUNT_ID]: resolved,
      };
    }

    if (ledgerAddress) {
      if (!isAddress(ledgerAddress)) {
        throw new ValidationError(`Invalid Ethereum address: ${ledgerAddress}`);
      }
      return fields;
    }

    throw new ValidationError(`Either '${FIELD_CUSTODY_ACCOUNT_ID}' or '${FIELD_LEDGER_ACCOUNT_ID}' must be provided`);
  }
}
