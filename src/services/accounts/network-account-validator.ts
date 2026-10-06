import { AccountInvalidShapeError, NetworkAccount, NetworkAccountValidator } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { isAddress } from 'ethers';

/**
 * Pre-bind validator for investor network accounts: EVM wallet addresses are
 * bindable on this adapter, and custodial accounts too when the binding has
 * to keep its custody account id (no account mapping to hold it).
 */
export class EvmNetworkAccountValidator implements NetworkAccountValidator {

  constructor(private readonly options: { custodial?: boolean } = {}) {}

  async validate(account: NetworkAccount): Promise<void> {
    if (account.type === 'custodialAccount' && this.options.custodial) {
      if (!account.vaultAccountId) throw new AccountInvalidShapeError('custodial account without a vault account id');
      return;
    }
    if (account.type !== 'walletAccount') {
      throw new AccountInvalidShapeError(`Unsupported network account type: ${account.type}`);
    }
    if (!isAddress(account.address)) {
      throw new AccountInvalidShapeError(`Invalid Ethereum address: ${account.address}`);
    }
  }
}
