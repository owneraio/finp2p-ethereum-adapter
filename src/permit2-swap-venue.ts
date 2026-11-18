import type {
  Logger,
  SwapIntent,
  SwapSubmission,
  SwapVenue,
  TokenWallet,
} from "@owneraio/finp2p-ethereum-adapter-contract";
import { executedSwap, failedSwap } from "@owneraio/finp2p-ethereum-adapter-contract";
import { Permit2Swap, SwapExecution, SwapLeg } from "@owneraio/finp2p-ethereum-permit2-swap";

export type Permit2SwapVenueOptions = {
  executionLookbackBlocks?: number;
};

const DefaultLookbackBlocks = 5_000;

/**
 * Swap venue on a Permit2Swap contract. The operator relays `executeSwap`; each
 * party must already have approved Permit2 and submitted a signed Permit2
 * allowance for the contract. The first caller settles both legs and the other
 * side resumes from the SwapExecuted event.
 *
 * `venueAddress` is Permit2, the funds-entry point of a permit-based venue.
 * `swapAddress` is the Permit2Swap contract the router lists and sends in
 * `executionContext.contract`.
 */
export class Permit2SwapVenue implements SwapVenue {
  private readonly executionLookbackBlocks: number;

  constructor(
    readonly swapAddress: string,
    readonly venueAddress: string,
    options: Permit2SwapVenueOptions = {},
  ) {
    this.executionLookbackBlocks = options.executionLookbackBlocks ?? DefaultLookbackBlocks;
  }

  async swap(wallet: TokenWallet, intent: SwapIntent, logger: Logger): Promise<SwapSubmission> {
    const tag = `permit2-swap ${intent.operationId}`;
    try {
      const contract = new Permit2Swap(this.swapAddress, wallet.signer);
      const head = await wallet.provider.getBlockNumber();
      const lookbackFrom = Math.max(0, head - this.executionLookbackBlocks);

      const resumed = await resumeExecuted(contract, intent.operationId, lookbackFrom, logger, tag);
      if (resumed) {
        return resumed;
      }
      await warnRelay(wallet, intent, logger, tag);
      try {
        return asExecuted(await contract.executeSwap(intent.operationId, legOf(intent)));
      } catch (e) {
        return await recoverFromRevert(contract, intent.operationId, lookbackFrom, logger, tag, e);
      }
    } catch (e) {
      return failedSwap(`${tag}: ${reasonOf(e)}`);
    }
  }
}

const resumeExecuted = async (
  contract: Permit2Swap, operationId: string, lookbackFrom: number, logger: Logger, tag: string,
): Promise<SwapSubmission | undefined> => {
  if (!(await contract.isExecuted(operationId))) {
    return undefined;
  }
  const execution = await contract.findExecution(operationId, lookbackFrom)
    ?? await contract.findExecution(operationId, 0);
  if (!execution) {
    throw new Error("marked executed but no SwapExecuted event was found");
  }
  logger.info(`${tag}: already executed in tx ${execution.transactionHash}, resuming with it`);
  return asExecuted(execution);
};

const warnRelay = async ({ signer }: TokenWallet, { give }: SwapIntent, logger: Logger, tag: string): Promise<void> => {
  const relayer = await signer.getAddress();
  if (relayer.toLowerCase() !== give.party.toLowerCase()) {
    logger.warn(`${tag}: signer ${relayer} relays for ${give.party}; expecting the party's Permit2 allowance to be in place`);
  }
};

const recoverFromRevert = async (
  contract: Permit2Swap, operationId: string, lookbackFrom: number, logger: Logger, tag: string, error: unknown,
): Promise<SwapSubmission> => {
  const raced = await contract.findExecution(operationId, lookbackFrom);
  if (raced) {
    logger.warn(`${tag}: submission lost the race to the executing transaction ${raced.transactionHash}, resuming with it`);
    return asExecuted(raced);
  }
  return failedSwap(`${tag}: submission failed: ${reasonOf(error)}`);
};

const legOf = ({ give, take }: SwapIntent): SwapLeg => ({
  token: give.token,
  party: give.party,
  amount: give.amount,
  counterToken: take.token,
  counterParty: take.party,
  counterAmount: take.amount,
});

const asExecuted = ({ transactionHash, blockNumber, timestamp }: SwapExecution): SwapSubmission =>
  executedSwap(transactionHash, blockNumber, timestamp);

const reasonOf = (e: any): string => e?.shortMessage ?? e?.reason ?? e?.message ?? String(e);
