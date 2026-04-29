import winston from "winston";
import { ERC20Contract } from "@owneraio/finp2p-contracts";
import { GasStation } from "../../../services/direct";
import { fundGasIfNeeded } from "../../../services/direct/helpers";
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
    // ERC20Contract requires a signer for read calls; reuse the ephemeral wallet's
    // (it's already provider-attached and the read still goes through the provider).
    const erc20 = new ERC20Contract(
      deposit.ephemeralWallet.provider, deposit.ephemeralWallet.signer,
      deposit.contractAddress, this.logger,
    );
    const balance: bigint = await erc20.balanceOf(deposit.ephemeralAddress);
    if (balance === 0n) return;
    if (deposit.expectedAmount && balance < BigInt(deposit.expectedAmount)) {
      this.logger.info(`OTA-deposit: balance ${balance} < expected ${deposit.expectedAmount} on ${deposit.ephemeralAddress}, waiting for more`);
      return;
    }
    this.inFlight.add(deposit.correlationId);
    try {
      this.logger.info(`OTA-deposit: detected balance ${balance} on ${deposit.ephemeralAddress} for deposit ${deposit.correlationId}`);
      const sweepTxHash = await this.sweep(deposit, balance, erc20);
      this.stop(deposit.correlationId);
      await this.onTransferDetected({
        deposit,
        sender: '',
        receivedAmount: balance.toString(),
        inboundTxHash: '',
        sweepTxHash,
      });
    } finally {
      this.inFlight.delete(deposit.correlationId);
    }
  }

  private async sweep(deposit: OtaDeposit, amount: bigint, erc20: ERC20Contract): Promise<string | undefined> {
    if (!this.gasStation) {
      this.logger.warn(
        `OTA-deposit: no gasStation configured — leaving ${amount} at ephemeral ${deposit.ephemeralAddress} (deposit ${deposit.correlationId}, custodyId ${deposit.custodyAccountId})`,
      );
      return undefined;
    }
    await fundGasIfNeeded(this.logger, this.gasStation, deposit.ephemeralWallet);
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
