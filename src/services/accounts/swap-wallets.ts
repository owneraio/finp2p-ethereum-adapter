import { SwapAssetLeg, SwapSettlementLeg } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { isAddress } from "ethers";
import { ValidationError } from "@owneraio/finp2p-ethereum-orchestrator";
import { ledgerAccountAddress } from "./account-resolver";

export type SwapWallets = {
  /** asset-leg source — the wallet the ERC20 approval to the swap contract comes from */
  approvalWallet?: string;
  /** settlement-leg destination — the wallet the counter-leg is delivered to */
  destinationWallet?: string;
};

/**
 * Source/destination on a swap leg may optionally carry a network account
 * (walletAccount / caip10Account — custodialAccount has no address and resolves
 * elsewhere). Every address that IS present must be a valid EVM address, and a
 * caip10 network must match this adapter's chain — checked up front, before
 * anything is submitted on-chain.
 *
 * Returns the two wallets the swap itself needs: the "approval from" wallet
 * (asset-leg source) and the "swap to" wallet (settlement-leg destination).
 * Absent addresses come back undefined — the caller decides how to resolve
 * them (credentials registry / account mapping) or reject.
 */
export function validateSwapWallets(asset: SwapAssetLeg, settlement: SwapSettlementLeg, chainId: bigint): SwapWallets {
  const addressOf = (label: string, account: SwapAssetLeg["source"]["account"]): string | undefined => {
    let address: string | undefined;
    try {
      address = ledgerAccountAddress(account, chainId);
    } catch (e) {
      throw new ValidationError(`${label}: ${(e as Error).message}`);
    }
    if (address !== undefined && !isAddress(address)) {
      throw new ValidationError(`${label}: '${address}' is not a valid Ethereum address`);
    }
    return address;
  };
  const approvalWallet = addressOf("asset source", asset.source.account);
  addressOf("asset destination", asset.destination.account);
  addressOf("settlement source", settlement.source.account);
  const destinationWallet = addressOf("settlement destination", settlement.destination.account);
  return { approvalWallet, destinationWallet };
}
