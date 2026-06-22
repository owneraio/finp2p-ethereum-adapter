import { ZeroAddress } from "ethers";
import { FinP2PContract } from "@owneraio/finp2p-contracts";

/**
 * Address-only resolver for finp2p-contract mode (no custody provider).
 *
 * Looks up the on-chain ETH address registered for a finId in the FINP2POperator
 * contract's credentials registry (`getCredentialAddress`). Returns `undefined`
 * when no credential is registered (the contract returns the zero address).
 *
 * Reusable across plugins that need finId → address resolution in this mode.
 */
export type FinP2PContractWalletResolver = (finId: string) => Promise<string | undefined>;

export function createFinP2PContractWalletResolver(
  finP2PContract: FinP2PContract,
): FinP2PContractWalletResolver {
  return async (finId) => {
    const address = await finP2PContract.getCredentialAddress(finId);
    return address && address !== ZeroAddress ? address : undefined;
  };
}
