import {
  AccountOperation,
  BindInfo,
  NetworkAccountServiceImpl,
  NetworkAccountValidator,
  ValidationError,
  successfulAccountOperation,
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

  async createAccount(idempotencyKey: string, organizationId: string, assetId: string, finId: string | undefined, bindInfo: BindInfo | undefined): Promise<AccountOperation> {
    // the OAS marks finId optional "for backward compatibility" only — a
    // request without it comes from a legacy router and can't be served here,
    // since the credential registration below is keyed by it
    if (!finId) {
      throw new ValidationError('finId is required for network-account onboarding on the on-chain adapter');
    }

    // replay check up-front: a re-sent create-new must return the recorded
    // wallet, not generate (and register) a fresh one
    if (idempotencyKey) {
      const existing = await this.store.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        return successfulAccountOperation('', { id: existing.accountId, account: existing.account });
      }
    }

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
