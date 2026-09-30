import { SwapLeg } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { isAddress } from "ethers";
import { ValidationError } from "@owneraio/finp2p-ethereum-orchestrator";
import { ledgerAccountAddress } from "./account-resolver";

export type SwapWallets = {
  approvalWallet?: string;
  destinationWallet?: string;
};

export function validateSwapWallets(asset: SwapLeg, settlement: SwapLeg, chainId: bigint): SwapWallets {
  const addressOf = (label: string, account: SwapLeg["source"]["account"]): string | undefined => {
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
