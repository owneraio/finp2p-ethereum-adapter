import winston from "winston";
import { formatUnits, parseUnits } from "ethers";
// The single ERC20 source is the eth-tools erc20 plugin; its package index does
// not (yet) export the contract wrapper, hence the dist path.
import { Erc20Contract } from "@owneraio/finp2p-ethereum-erc20-plugin/dist/src/contracts/erc20";
import { GasStation } from "../../../services/funding";
import { OtaDeposit, OtaResult } from "./models";

const DEFAULT_POLL_INTERVAL_MS = 60000;

/**
 * Per-deposit balance-poll watcher: every `pollIntervalMs` it queries
 * `balanceOf(ephemeralAddress)` for each open OTA deposit. When the balance crosses
 * the expected threshold, it sweeps to `sweepTarget` (gas funded via the operator's
 * gas-station), invokes onTransferDetected, and stops polling for that deposit.
 *
 * Polling rather than event subscription because event-listener semantics vary across
 * providers (Fireblocks BrowserProvider drops filters; public RPCs garbage-collect them),
 * and we already know the destination address per deposit — direct balanceOf is simpler
 * and deterministic.
 */
export class BalanceWatcher {
  private readonly deposits = new Map<string, OtaDeposit>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly logger: winston.Logger,
    private readonly gasStation: GasStation | undefined,
    private readonly onTransferDetected: (result: OtaResult) => Promise<void>,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  addDeposit(deposit: OtaDeposit): void {
    this.deposits.set(deposit.correlationId, deposit);
    this.logger.info(`OTA-deposit: polling balanceOf(${deposit.ephemeralAddress}) on ${deposit.contractAddress} every ${this.pollIntervalMs}ms`);
    const timer = setInterval(() => {
      this.pollOnce(deposit).catch((e) =>
        this.logger.error(`OTA-deposit: poll failed for deposit ${deposit.correlationId}: ${e?.message ?? e}`),
      );
    }, this.pollIntervalMs);
    this.timers.set(deposit.correlationId, timer);
  }

  private stop(correlationId: string): void {
    const t = this.timers.get(correlationId);
    if (t) clearInterval(t);
    this.timers.delete(correlationId);
    this.deposits.delete(correlationId);
    this.inFlight.delete(correlationId);
  }

  private async pollOnce(deposit: OtaDeposit): Promise<void> {
    if (this.inFlight.has(deposit.correlationId)) return;
    if (!this.deposits.has(deposit.correlationId)) return;
    // Reads bind to the signer's provider (the ephemeral wallet is provider-attached).
    const erc20 = new Erc20Contract(deposit.ephemeralWallet.signer, deposit.contractAddress);
    const balance: bigint = await erc20.balanceOf(deposit.ephemeralAddress);
    if (balance === 0n) return;
    // expectedAmount is human-readable (caller convention); convert to base units for
    // on-chain math.
    const expectedBaseUnits = deposit.expectedAmount ? parseUnits(deposit.expectedAmount, deposit.decimals) : undefined;
    if (expectedBaseUnits !== undefined && balance < expectedBaseUnits) {
      this.logger.info(`OTA-deposit: balance ${balance} < expected ${expectedBaseUnits} (${deposit.expectedAmount}) on ${deposit.ephemeralAddress}, waiting for more`);
      return;
    }
    this.inFlight.add(deposit.correlationId);
    try {
      this.logger.info(`OTA-deposit: detected balance ${balance} on ${deposit.ephemeralAddress} for deposit ${deposit.correlationId}`);
      const sweepTxHash = await this.sweep(deposit, balance, erc20);
      if (!sweepTxHash) {
        // Sweep didn't succeed (no gasStation, sweep tx failed, or gas-funding tx
        // not yet settled → INSUFFICIENT_FUNDS_FOR_FEE). Don't fire onTransferDetected
        // — that would credit a receipt with no on-chain proof and leave the funds
        // stranded at the ephemeral. The next poll will retry the sweep with the
        // same balance. Operator should ensure gasStation is configured if it isn't.
        this.logger.info(`OTA-deposit: sweep not yet confirmed for deposit ${deposit.correlationId}, keeping it open for retry`);
        return;
      }
      this.stop(deposit.correlationId);
      await this.onTransferDetected({
        deposit,
        // Hand caller-facing receivedAmount in human-readable units — vanilla hook does
        // parseUnits(amount, decimals) internally; FinAPI importTransactions expects the
        // same convention.
        receivedAmount: formatUnits(balance, deposit.decimals),
        sweepTxHash,
      });
    } finally {
      this.inFlight.delete(deposit.correlationId);
    }
  }

  private async sweep(deposit: OtaDeposit, amount: bigint, erc20: Erc20Contract): Promise<string | undefined> {
    if (!this.gasStation) {
      this.logger.warn(
        `OTA-deposit: no gasStation configured — leaving ${amount} at ephemeral ${deposit.ephemeralAddress} (deposit ${deposit.correlationId}, custodyId ${deposit.custodyAccountId})`,
      );
      return undefined;
    }
    await this.gasStation.ensureGas(await deposit.ephemeralWallet.signer.getAddress());
    const tx = await erc20.transfer(deposit.sweepTarget, amount);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      this.logger.error(`OTA-deposit: sweep tx failed for deposit ${deposit.correlationId}`);
      return undefined;
    }
    this.logger.info(`OTA-deposit: swept ${amount} from ${deposit.ephemeralAddress} → ${deposit.sweepTarget} (tx ${receipt.hash})`);
    return receipt.hash;
  }
}
