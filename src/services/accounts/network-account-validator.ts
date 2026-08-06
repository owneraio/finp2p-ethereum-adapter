import { AccountInvalidShapeError, NetworkAccount, NetworkAccountValidator } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { isAddress } from 'ethers';

/**
 * Pre-bind validator for investor network accounts: only EVM wallet
 * addresses are bindable on this adapter.
 */
export class EvmNetworkAccountValidator implements NetworkAccountValidator {

  async validate(account: NetworkAccount): Promise<void> {
    if (account.type !== 'walletAccount') {
      throw new AccountInvalidShapeError(`Unsupported network account type: ${account.type}`);
    }
    if (!isAddress(account.address)) {
      throw new AccountInvalidShapeError(`Invalid Ethereum address: ${account.address}`);
    }
  }
}
