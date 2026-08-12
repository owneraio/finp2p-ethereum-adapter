import { randomUUID } from 'crypto';
import {
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  storage,
  successfulAccountOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract, WalletResolutionMode } from '@owneraio/finp2p-ethereum-orchestrator';

/**
 * Investor onboarding for the on-chain operator contract, driven by the
 * contract's wallet resolution mode (read once at service start):
 *
 * - WalletMapping: an operation referencing a finId with no entry in the
 *   credentials registry reverts, so onboarding binds the investor's wallet
 *   via addCredential. Create-new is not supported — the adapter never
 *   derives a wallet from the finId off-chain.
 * - FinIdDerivation (demo mode): the contract derives wallets from the
 *   finId's compressed public key and the credentials mapping is disabled
 *   (addCredential reverts), so onboarding is a no-op success — nothing to
 *   register, nothing stored.
 */
export class OnChainNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly finP2PContract: FinP2PContract,
    private readonly resolutionMode: WalletResolutionMode,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    if (this.resolutionMode === WalletResolutionMode.FinIdDerivation) {
      if (bindInfo) await this.validator?.validate(bindInfo.account);
      return successfulAccountOperation('', { id: randomUUID(), account: bindInfo?.account ?? { type: 'none' } });
    }

    if (bindInfo) {
      // bind-existing: validate the wallet shape before touching the chain
      // (super validates again — cheap and keeps its invariants intact)
      await this.validator?.validate(bindInfo.account);
      if (bindInfo.account.type === 'walletAccount') {
        await this.finP2PContract.addCredential(finId, bindInfo.account.address);
      }
    }
    // create-new (no bindInfo) falls through to the base NotSupported rejection
    return super.createAccount(idempotencyKey, organizationId, assetId, finId, bindInfo);
  }

  async removeAccount(idempotencyKey: string, accountId: string): Promise<AccountOperation> {
    if (this.resolutionMode === WalletResolutionMode.FinIdDerivation) {
      return successfulAccountOperation('', { id: accountId, account: { type: 'none' } });
    }
    return super.removeAccount(idempotencyKey, accountId);
  }
}
