import type {
  Logger,
  SwapIntent,
  SwapSubmission,
  SwapVenue,
  TokenWallet,
} from "@owneraio/finp2p-ethereum-adapter-contract";
import { executedSwap, failedSwap } from "@owneraio/finp2p-ethereum-adapter-contract";
import {
  Permit2Swap, SwapExecution, SwapLeg, legsMatch, mirrored,
} from "@owneraio/finp2p-ethereum-permit2-swap";

export type Permit2SwapVenueOptions = {
  /** Permit2 address the contract must be bound to. Unchecked when unset. */
  permit2Address?: string;
  /** Deadline window in seconds, used when an intent carries no deadline. */
  defaultDeadlineSeconds?: number;
  executionLookbackBlocks?: number;
};

export const DEFAULT_DEADLINE_SECONDS = 900;
const DefaultLookbackBlocks = 5_000;

/**
 * Swap venue on a Permit2Swap contract. The operator relays `executeSwap` and
 * must hold its EXECUTOR_ROLE. Each party must already have approved Permit2
 * and submitted a signed Permit2 allowance for the contract; the adapter signs
 * nothing for investors. The first caller settles both legs and the other side
 * resumes from the SwapExecuted event.
 *
 * `venueAddress` is the Permit2Swap contract, the address the router lists and
 * sends in `executionContext.contract`. Funds move through Permit2.
 */
export class Permit2SwapVenue implements SwapVenue {
  private readonly permit2Address: string | undefined;
  private readonly defaultDeadlineSeconds: number;
  private readonly executionLookbackBlocks: number;

  constructor(
    readonly venueAddress: string,
    options: Permit2SwapVenueOptions = {},
  ) {
    this.permit2Address = options.permit2Address;
    this.defaultDeadlineSeconds = options.defaultDeadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    this.executionLookbackBlocks = options.executionLookbackBlocks ?? DefaultLookbackBlocks;
  }

  async swap(wallet: TokenWallet, intent: SwapIntent, logger: Logger): Promise<SwapSubmission> {
    const tag = `permit2-swap ${intent.operationId}`;
    try {
      const contract = new Permit2Swap(this.venueAddress, wallet.signer);
      const leg = legOf(intent);
      const head = await wallet.provider.getBlockNumber();
      const lookbackFrom = Math.max(0, head - this.executionLookbackBlocks);

      if (await contract.isExecuted(intent.operationId)) {
        const execution = await contract.findExecution(intent.operationId, lookbackFrom)
          ?? await contract.findExecution(intent.operationId, 0);
        if (!execution) {
          throw new Error("marked executed but no SwapExecuted event was found");
        }
        logger.info(`${tag}: already executed in tx ${execution.transactionHash}, resuming with it`);
        return resumedWith(execution, leg, tag);
      }

      const deadline = this.deadlineOf(intent, logger, tag);
      if (deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwap(`${tag}: swap deadline ${deadline} has already passed`);
      }
      const relayer = await wallet.signer.getAddress();
      if (!(await contract.isExecutor(relayer))) {
        return failedSwap(`${tag}: operator ${relayer} does not hold EXECUTOR_ROLE on Permit2Swap ${this.venueAddress}`);
      }
      const bound = await this.permit2Mismatch(contract);
      if (bound) {
        return failedSwap(`${tag}: ${bound}`);
      }
      warnRelay(relayer, intent, logger, tag);
      try {
        return executed(await contract.executeSwap(intent.operationId, leg, deadline));
      } catch (e) {
        return await recoverFromRevert(contract, intent.operationId, leg, lookbackFrom, logger, tag, e);
      }
    } catch (e) {
      return failedSwap(`${tag}: ${reasonOf(e)}`);
    }
  }

  private deadlineOf(intent: SwapIntent, logger: Logger, tag: string): number {
    if (intent.deadline) {
      return intent.deadline;
    }
    // TODO(#1357 OQ-deadline): provisional window when the intent has no deadline.
    const deadline = Math.floor(Date.now() / 1000) + this.defaultDeadlineSeconds;
    logger.info(`${tag}: no deadline on the intent, using ${deadline} (now + ${this.defaultDeadlineSeconds}s)`);
    return deadline;
  }

  private async permit2Mismatch(contract: Permit2Swap): Promise<string | undefined> {
    if (!this.permit2Address) {
      return undefined;
    }
    const actual = await contract.permit2();
    return actual.toLowerCase() === this.permit2Address.toLowerCase()
      ? undefined
      : `Permit2Swap ${this.venueAddress} is bound to Permit2 ${actual}, expected ${this.permit2Address}`;
  }
}

/** Either side of the swap may be the caller, so the executed leg or its mirror is ours. */
const resumedWith = (execution: SwapExecution & { leg: SwapLeg }, expected: SwapLeg, tag: string): SwapSubmission =>
  legsMatch(execution.leg, expected) || legsMatch(execution.leg, mirrored(expected))
    ? executed(execution)
    : failedSwap(`${tag}: the operation id was already used by a different swap in tx ${execution.transactionHash}`);

const warnRelay = (relayer: string, { give }: SwapIntent, logger: Logger, tag: string): void => {
  if (relayer.toLowerCase() !== give.party.toLowerCase()) {
    logger.warn(`${tag}: signer ${relayer} relays for ${give.party}; expecting the party's Permit2 allowance to be in place`);
  }
};

const recoverFromRevert = async (
  contract: Permit2Swap, operationId: string, leg: SwapLeg, lookbackFrom: number, logger: Logger, tag: string, error: unknown,
): Promise<SwapSubmission> => {
  const raced = await contract.findExecution(operationId, lookbackFrom);
  if (raced) {
    logger.warn(`${tag}: submission lost the race to the executing transaction ${raced.transactionHash}, resuming with it`);
    return resumedWith(raced, leg, tag);
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

const executed = ({ transactionHash, blockNumber, timestamp }: SwapExecution): SwapSubmission =>
  executedSwap(transactionHash, blockNumber, timestamp);

const reasonOf = (e: any): string => e?.shortMessage ?? e?.reason ?? e?.message ?? String(e);
