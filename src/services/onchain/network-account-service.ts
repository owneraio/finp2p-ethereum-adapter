import {
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  successfulAccountOperation,
  storage,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { FinP2PContract, createAccount as generateAccount } from '@owneraio/finp2p-ethereum-orchestrator';

/**
 * Investor onboarding for the on-chain operator contract: an operation
 * referencing a finId with no entry in the contract's credentials registry
 * reverts, so onboarding is where credentials get registered.
 */
export class OnChainNetworkAccountService extends NetworkAccountServiceImpl {

  constructor(
    store: storage.NetworkAccountStore,
    private readonly finP2PContract: FinP2PContract,
    validator?: NetworkAccountValidator,
  ) {
    super(store, validator);
  }

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    // replay check up-front: a re-sent create-new must return the recorded
    // wallet, not generate (and register) a fresh one
    if (idempotencyKey) {
      const existing = await this.store.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        return successfulAccountOperation('', { id: existing.accountId, account: existing.account });
      }
    }

    if (!bindInfo) {
      // create-new: the wallet and its finId come from the same generated key
      // (finId = compressed pubkey), so the credential is registrable here.
      // The private key is discarded — no investor-side signing until key
      // management exists for LA-generated wallets.
      const { finId, address } = generateAccount();
      await this.finP2PContract.addCredential(finId, address);
      return super.createAccount(idempotencyKey, organizationId, assetId, { account: { type: 'walletAccount', address } });
    }

    // GAP: bind-existing should also register the wallet in the credentials
    // registry, but the onboarding request carries no investor finId (BindInfo
    // is only { account, ownershipSignature? }, and the router forwards the
    // ownership hint with template: null). Until the protocol delivers the
    // finId at onboarding time, the credential for a bound wallet is never
    // registered and on-chain operations for it will revert:
    // await this.finP2PContract.addCredential(finId, bindInfo.account.address);
    return super.createAccount(idempotencyKey, organizationId, assetId, bindInfo);
  }
}
