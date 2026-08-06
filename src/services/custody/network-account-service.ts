import winston from 'winston';
import {
  AccountInvalidShapeError,
  AccountMappingServiceImpl,
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FIELD_CUSTODY_ACCOUNT_ID, FIELD_LEDGER_ACCOUNT_ID } from '../accounts/mapping-validator';
import { CustodyProvider } from './custody-provider';

const ETH_ADDRESS_FORMAT = /^0x[0-9a-fA-F]{40}$/;

/**
 * Investor onboarding for custody modes.
 *
 * A custodialAccount bind carries the custody account id (e.g. a Fireblocks
 * vault account id) explicitly and is resolved to its wallet address via the
 * custody provider; a walletAccount address in EVM format binds as-is, and a
 * walletAccount address in any other format is treated as a custody account
 * id too — a temporary overload kept until routers send custodialAccount.
 * Every binding is normalized to the resolved walletAccount and mirrored into
 * the account-mapping store, which is what every operational resolver reads
 * (token services, plan approval, deposits); the custody account id is kept
 * on the mapping so per-operation signing skips the vault scan. The mapping
 * is per finId and shared across the investor's asset bindings, so unbinding
 * one asset leaves it in place.
 */
export class CustodyNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly custodyProvider: CustodyProvider | undefined,
    private readonly mappingService: AccountMappingServiceImpl,
    private readonly logger: winston.Logger,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    let effectiveBind = bindInfo;
    let custodyAccountId: string | undefined;
    if (bindInfo?.account.type === 'custodialAccount') {
      custodyAccountId = bindInfo.account.vaultAccountId;
      const address = await this.resolveCustodyAddress(custodyAccountId);
      this.logger.info(`onboarding: custodial account ${custodyAccountId} (provider '${bindInfo.account.provider}') resolved to ${address}`);
      effectiveBind = { ...bindInfo, account: { type: 'walletAccount', address } };
    } else if (bindInfo?.account.type === 'walletAccount' && !ETH_ADDRESS_FORMAT.test(bindInfo.account.address)) {
      custodyAccountId = bindInfo.account.address;
      const address = await this.resolveCustodyAddress(custodyAccountId);
      this.logger.info(`onboarding: '${custodyAccountId}' taken as a custody account id, resolved to ${address}`);
      effectiveBind = { ...bindInfo, account: { type: 'walletAccount', address } };
    }

    const op = await super.createAccount(idempotencyKey, organizationId, assetId, finId, effectiveBind);
    if (op.type !== 'success' || op.record.account.type !== 'walletAccount') return op;
    const address = op.record.account.address;

    await this.mappingService.saveAccount(finId, custodyAccountId
      ? { [FIELD_LEDGER_ACCOUNT_ID]: address, [FIELD_CUSTODY_ACCOUNT_ID]: custodyAccountId }
      : { [FIELD_LEDGER_ACCOUNT_ID]: address });

    return op;
  }

  private async resolveCustodyAddress(custodyAccountId: string): Promise<string> {
    if (!this.custodyProvider?.resolveAddressFromCustodyId) {
      throw new AccountInvalidShapeError(`'${custodyAccountId}' is not an EVM address and the custody provider cannot resolve custody account ids`);
    }
    try {
      return await this.custodyProvider.resolveAddressFromCustodyId(custodyAccountId);
    } catch (e) {
      throw new AccountInvalidShapeError(`cannot resolve custody account '${custodyAccountId}' to a wallet address: ${(e as Error).message}`);
    }
  }
}
