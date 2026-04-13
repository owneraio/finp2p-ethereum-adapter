import { MappingConfig } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { CustodyProvider } from "./custody-provider";
import { CustodyMappingValidator, FIELD_CUSTODY_ACCOUNT_ID, FIELD_LEDGER_ACCOUNT_ID } from "./mapping-validator";

export function buildMappingConfig(custodyProvider?: CustodyProvider): MappingConfig {
  const fields = [
    { field: FIELD_LEDGER_ACCOUNT_ID, description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' },
  ];
  if (custodyProvider?.resolveAddressFromCustodyId) {
    fields.unshift({
      field: FIELD_CUSTODY_ACCOUNT_ID, description: 'Custody provider account ID (vault ID / wallet ID)', exampleValue: '85',
    });
  }
  return {
    fields,
    validator: custodyProvider ? new CustodyMappingValidator(custodyProvider) : undefined,
  };
}
