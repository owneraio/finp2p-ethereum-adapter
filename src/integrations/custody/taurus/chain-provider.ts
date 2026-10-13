import { AbstractProvider, Interface, Network, PerformActionRequest, PerformActionTransaction, Subscriber, Subscription, TransactionReceipt, ZeroHash, toQuantity } from 'ethers';
import { TaurusClient } from './client';

const MINED = new Set(['SUCCESS', 'MINED']);
const TRANSACTION_FAILED = new Set(['INVALID', 'TIMEOUT', 'LOST', 'EXPIRED']);

const ERC20_READS = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

/**
 * Chain reads served by Taurus PROTECT instead of an RPC node: Taurus
 * broadcasts every transaction itself, so the adapter never submits and needs
 * no NETWORK_HOST. PROTECT answers the chain id and height, the confirmed
 * balances of addresses in custody (native and its currencies), ERC20
 * decimals, and receipts of the transactions it broadcast; any other read is
 * refused rather than guessed.
 */
export class TaurusChainProvider extends AbstractProvider {

  // the chain is at least at the block of any transaction PROTECT reported mined,
  // so a lagging PROTECT block height cannot hold a receipt below one confirmation
  private highestMinedBlock = 0;

  constructor(
    private readonly client: TaurusClient,
    private readonly chainId: bigint,
    pollingInterval: number,
    private readonly receiptTimeoutMs: number,
  ) {
    super(Network.from(chainId), { pollingInterval });
  }

  /** Re-checks PROTECT's record on a timer, not on new blocks, within TAURUS_REQUEST_TIMEOUT_MS. */
  async waitForTransaction(hash: string, confirms?: number | null, timeout?: number | null): Promise<TransactionReceipt | null> {
    const wanted = confirms ?? 1;
    if (wanted === 0) return this.getTransactionReceipt(hash);
    const limitMs = timeout ?? this.receiptTimeoutMs;
    const deadline = Date.now() + limitMs;
    for (;;) {
      const receipt = await this.getTransactionReceipt(hash);
      if (receipt && (await receipt.confirmations()) >= wanted) return receipt;
      if (Date.now() >= deadline) {
        throw new Error(`Taurus broadcast ${hash} but PROTECT did not report it settled within ${limitMs}ms; it may still confirm, do not resubmit`);
      }
      await new Promise(r => setTimeout(r, this.pollingInterval));
    }
  }

  // A pending transaction is re-checked on a timer, not on new blocks: PROTECT's
  // block height may lag, and a receipt must not wait on it.
  _getSubscriber(sub: Subscription): Subscriber {
    if (sub.type === 'transaction') return new ReceiptPoller(this, sub.hash, this.pollingInterval);
    return super._getSubscriber(sub);
  }

  async _detectNetwork(): Promise<Network> {
    return Network.from(this.chainId);
  }

  async _perform<T = any>(req: PerformActionRequest): Promise<T> {
    switch (req.method) {
      case 'chainId':
        return toQuantity(this.chainId) as T;
      case 'getBlockNumber':
        return toQuantity(Math.max(await this.client.getBlockHeight(), this.highestMinedBlock)) as T;
      case 'getBalance': {
        const native = await this.client.findNativeCurrencyOrFail();
        return toQuantity(await this.client.getBalance(req.address, native.id)) as T;
      }
      case 'call':
        return await this.erc20Read(req.transaction) as T;
      case 'getTransactionReceipt':
        return await this.receipt(req.hash) as T;
      default:
        throw new Error(`Taurus PROTECT does not serve '${req.method}': chain reads in Taurus mode are limited to chain id, block height, custody balances and ERC20 decimals`);
    }
  }

  /**
   * The receipt of a transaction PROTECT broadcast, from its record: hash,
   * block, sender and outcome. PROTECT has no logs, block hash or gas figures
   * for it. A transaction PROTECT has not recorded as mined or failed yet has
   * no receipt; one that will never mine reports failure.
   */
  private async receipt(hash: string): Promise<Record<string, unknown> | null> {
    const tx = await this.client.findTransaction(hash);
    const status = tx?.status?.toUpperCase();
    if (!tx || !status || !(MINED.has(status) || TRANSACTION_FAILED.has(status))) return null;
    const blockNumber = tx.block ? Number(tx.block) : await this.client.getBlockHeight();
    this.highestMinedBlock = Math.max(this.highestMinedBlock, blockNumber);
    return {
      transactionHash: hash,
      blockHash: ZeroHash,
      blockNumber: toQuantity(blockNumber),
      transactionIndex: '0x0',
      from: tx.sources?.[0]?.address ?? null,
      to: null,
      contractAddress: null,
      logs: [],
      gasUsed: '0x0',
      cumulativeGasUsed: '0x0',
      effectiveGasPrice: '0x0',
      status: MINED.has(status) ? '0x1' : '0x0',
    };
  }

  private async erc20Read(tx: PerformActionTransaction): Promise<string> {
    const token = tx.to ? String(tx.to) : undefined;
    const call = token && tx.data ? ERC20_READS.parseTransaction({ data: String(tx.data) }) : null;
    if (!token || !call) {
      throw new Error(`Taurus PROTECT does not serve contract call ${String(tx.data ?? '').slice(0, 10)} on ${token}: only ERC20 balanceOf and decimals`);
    }
    const currency = await this.client.findCurrencyByContract(token);
    if (!currency) throw new Error(`Token ${token} is not a Taurus PROTECT currency on chain ${this.chainId}; whitelist the contract in PROTECT`);
    if (call.name === 'decimals') {
      if (currency.decimals === undefined) throw new Error(`Taurus currency ${currency.id} has no decimals`);
      return ERC20_READS.encodeFunctionResult('decimals', [Number(currency.decimals)]);
    }
    const balance = await this.client.getBalance(String(call.args[0]), currency.id);
    return ERC20_READS.encodeFunctionResult('balanceOf', [balance]);
  }
}

class ReceiptPoller implements Subscriber {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly provider: TaurusChainProvider, private readonly hash: string, private readonly intervalMs: number) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  pause(): void {
    this.stop();
  }

  resume(): void {
    this.start();
  }

  private async poll(): Promise<void> {
    const receipt = await this.provider.getTransactionReceipt(this.hash).catch(() => null);
    if (receipt) this.provider.emit(this.hash, receipt);
  }
}
