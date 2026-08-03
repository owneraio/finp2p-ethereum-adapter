import {
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract, finIdToAddress } from '@owneraio/finp2p-ethereum-orchestrator';

/**
 * Investor onboarding for the on-chain operator contract: an operation
 * referencing a finId with no entry in the contract's credentials registry
 * reverts, so onboarding is where the investor finId gets bound to a wallet
 * via addCredential.
 */
export class OnChainNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly finP2PContract: FinP2PContract,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    if (!bindInfo) {
      // create-new: the investor's wallet is the address derived from the
      // finId itself (finId = compressed secp256k1 pubkey), so the investor's
      // existing finId key signs for it — no LA-side key to generate or hold
      const address = finIdToAddress(finId);
      await this.finP2PContract.addCredential(finId, address);
      return super.createAccount(idempotencyKey, organizationId, assetId, finId, { account: { type: 'walletAccount', address } });
    }

    // bind-existing: validate the wallet shape before touching the chain
    // (super validates again — cheap and keeps its invariants intact)
    await this.validator?.validate(bindInfo.account);
    if (bindInfo.account.type === 'walletAccount') {
      await this.finP2PContract.addCredential(finId, bindInfo.account.address);
    }
    return super.createAccount(idempotencyKey, organizationId, assetId, finId, bindInfo);
  }
}
