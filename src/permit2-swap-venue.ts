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
import { Contract, Signer } from "ethers";

export type Permit2SwapVenueOptions = {
  /** Permit2 address the contract must be bound to. Unchecked when unset. */
  permit2Address?: string;
  /** Deadline window in seconds, used when an intent carries no deadline. */
  defaultDeadlineSeconds?: number;
  executionLookbackBlocks?: number;
  /**
   * Sends `executeSwap` when the wallet signs for the party itself (custody),
   * since a party wallet holds no EXECUTOR_ROLE. Unset: the wallet sends it.
   */
  executor?: Signer;
  /** How often a self-signing party checks for the counterparty's allowance. */
  pollIntervalMs?: number;
};

export const DEFAULT_DEADLINE_SECONDS = 900;
const DefaultLookbackBlocks = 5_000;
const DefaultPollIntervalMs = 2_000;

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const PERMIT2_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
];

/**
 * Swap venue on a Permit2Swap contract. `executeSwap` needs EXECUTOR_ROLE.
 * A wallet that signs for the party itself (custody) sets its own Permit2
 * allowance with `Permit2.approve` first and waits for the counterparty's; a relaying operator expects
 * both allowances in place. The first caller settles both legs and the other
 * side resumes from the SwapExecuted event.
 *
 * `venueAddress` is the Permit2Swap contract, the address the router lists and
 * sends in `executionContext.contract`. Funds move through Permit2.
 */
export class Permit2SwapVenue implements SwapVenue {
  private readonly permit2Address: string | undefined;
  private readonly defaultDeadlineSeconds: number;
  private readonly executionLookbackBlocks: number;
  private readonly executor: Signer | undefined;
  private readonly pollIntervalMs: number;

  constructor(
    readonly venueAddress: string,
    options: Permit2SwapVenueOptions = {},
  ) {
    this.permit2Address = options.permit2Address;
    this.defaultDeadlineSeconds = options.defaultDeadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    this.executionLookbackBlocks = options.executionLookbackBlocks ?? DefaultLookbackBlocks;
    this.executor = options.executor;
    this.pollIntervalMs = options.pollIntervalMs ?? DefaultPollIntervalMs;
  }

  async swap(wallet: TokenWallet, intent: SwapIntent, logger: Logger): Promise<SwapSubmission> {
    const tag = `permit2-swap ${intent.operationId}`;
    try {
      const signer = await wallet.signer.getAddress();
      const selfSigned = sameAddress(signer, intent.give.party);
      const sender = selfSigned && this.executor ? this.executor : wallet.signer;
      const contract = new Permit2Swap(this.venueAddress, sender);
      const leg = legOf(intent);
      const head = await wallet.provider.getBlockNumber();
      const lookbackFrom = Math.max(0, head - this.executionLookbackBlocks);

      if (await contract.isExecuted(intent.operationId)) {
        return await this.resume(contract, intent, leg, lookbackFrom, logger, tag);
      }

      const deadline = this.deadlineOf(intent, logger, tag);
      if (deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwap(`${tag}: swap deadline ${deadline} has already passed`);
      }
      const relayer = await sender.getAddress();
      if (!(await contract.isExecutor(relayer))) {
        return failedSwap(`${tag}: operator ${relayer} does not hold EXECUTOR_ROLE on Permit2Swap ${this.venueAddress}`);
      }
      const bound = await this.permit2Mismatch(contract);
      if (bound) {
        return failedSwap(`${tag}: ${bound}`);
      }
      if (selfSigned) {
        const permit2 = await contract.permit2();
        await this.grantOwnAllowance(wallet, intent, permit2, deadline, logger, tag);
        const ready = await this.awaitCounterAllowance(wallet, contract, intent, permit2, deadline, logger, tag);
        if (ready === "executed") {
          return await this.resume(contract, intent, leg, lookbackFrom, logger, tag);
        }
        if (ready === "timeout") {
          return failedSwap(`${tag}: the counterparty's Permit2 allowance was not in place before deadline ${deadline}`);
        }
      } else {
        logger.warn(`${tag}: signer ${signer} relays for ${intent.give.party}; expecting the party's Permit2 allowance to be in place`);
      }
      try {
        return executed(await contract.executeSwap(intent.operationId, leg, deadline));
      } catch (e) {
        return await recoverFromRevert(contract, intent.operationId, leg, lookbackFrom, logger, tag, e);
      }
    } catch (e) {
      return failedSwap(`${tag}: ${reasonOf(e)}`);
    }
  }

  private async resume(
    contract: Permit2Swap, intent: SwapIntent, leg: SwapLeg, lookbackFrom: number, logger: Logger, tag: string,
  ): Promise<SwapSubmission> {
    const execution = await contract.findExecution(intent.operationId, lookbackFrom)
      ?? await contract.findExecution(intent.operationId, 0);
    if (!execution) {
      throw new Error("marked executed but no SwapExecuted event was found");
    }
    logger.info(`${tag}: already executed in tx ${execution.transactionHash}, resuming with it`);
    return resumedWith(execution, leg, tag);
  }

  /**
   * Approves Permit2 for the leg when the token allowance is short, then sets
   * a Permit2 allowance for this contract that expires at the swap deadline.
   * A plain transaction from the wallet, so no typed-data signing is needed.
   * Skips both when a large enough allowance that outlives the deadline is in place.
   */
  private async grantOwnAllowance(
    wallet: TokenWallet, { give }: SwapIntent, permit2Address: string, deadline: number, logger: Logger, tag: string,
  ): Promise<void> {
    const permit2 = new Contract(permit2Address, PERMIT2_ABI, wallet.signer);
    const [amount, expiration] = await permit2.allowance(give.party, give.token, this.venueAddress);
    if (amount >= give.amount && Number(expiration) >= deadline) {
      logger.info(`${tag}: Permit2 allowance of ${give.party} for ${this.venueAddress} already covers ${give.amount}`);
      return;
    }
    const token = new Contract(give.token, ERC20_ABI, wallet.signer);
    if ((await token.allowance(give.party, permit2Address)) < give.amount) {
      logger.info(`${tag}: approving Permit2 for ${give.amount} of ${give.token}`);
      await (await token.approve(permit2Address, give.amount)).wait();
    }
    logger.info(`${tag}: granting ${give.amount} of ${give.token} to ${this.venueAddress} through Permit2 until ${deadline}`);
    await (await permit2.approve(give.token, this.venueAddress, give.amount, deadline)).wait();
  }

  /** Each side grants inside its own swap call, so the counter leg may arrive later. */
  private async awaitCounterAllowance(
    wallet: TokenWallet, contract: Permit2Swap, { operationId, take }: SwapIntent, permit2Address: string,
    deadline: number, logger: Logger, tag: string,
  ): Promise<"ready" | "executed" | "timeout"> {
    const permit2 = new Contract(permit2Address, PERMIT2_ABI, wallet.provider);
    let logged = false;
    for (;;) {
      if (await contract.isExecuted(operationId)) {
        return "executed";
      }
      const [amount, expiration] = await permit2.allowance(take.party, take.token, this.venueAddress);
      // Permit2 checks expiry against the block clock; an idle chain's clock stands still
      const chainNow = (await wallet.provider.getBlock("latest"))?.timestamp ?? 0;
      if (amount >= take.amount && Number(expiration) >= chainNow) {
        return "ready";
      }
      if (Math.max(chainNow, Math.floor(Date.now() / 1000)) >= deadline) {
        return "timeout";
      }
      if (!logged) {
        logger.info(`${tag}: waiting for the Permit2 allowance of ${take.party}`);
        logged = true;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
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

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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
