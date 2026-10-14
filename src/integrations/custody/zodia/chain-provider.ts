import { AbstractProvider, Interface, Network, PerformActionRequest, PerformActionTransaction, TransactionReceipt, ZeroHash, parseUnits, toQuantity } from 'ethers';
import { ZodiaClient, ZodiaWallet } from './client';
import { ZodiaCurrencyRef } from './config';

const ERC20_READS = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export type ZodiaReadApi = Pick<ZodiaClient, 'wallets'>;

/** A transfer the adapter saw Zodia post on chain, or end otherwise. */
export interface SettledTransfer {
  status: 0 | 1;
  from: string;
  /** when Zodia recorded the transfer, in seconds */
  timestamp: number;
}

/**
 * Chain reads served by Zodia instead of an RPC node: Zodia broadcasts every
 * transfer itself, so the adapter never submits and needs no NETWORK_HOST.
 * Zodia answers the available balances of the company's wallets (a deposit
 * Zodia has not released yet does not count) and ERC20 decimals; receipts are
 * those of the transfers this adapter settled, since Zodia reports no blocks
 * and cannot be asked by hash. Block height needs no Zodia call at all, so a
 * readiness probe cannot spend Zodia's per-endpoint rate limit. Anything else
 * is refused rather than guessed.
 */
export class ZodiaChainProvider extends AbstractProvider {

  private readonly settled = new Map<string, SettledTransfer>();

  constructor(
    private readonly api: ZodiaReadApi,
    private readonly chainId: bigint,
    private readonly native: ZodiaCurrencyRef,
    private readonly tokens: Map<string, ZodiaCurrencyRef>,
    private readonly walletIdOf: (address: string) => Promise<string | undefined>,
    private readonly decimalsOf: (currency: ZodiaCurrencyRef) => Promise<number | undefined>,
  ) {
    super(Network.from(chainId));
  }

  /** The signer records each transfer it settles, so the receipt is there before anyone asks for it. */
  recordSettled(hash: string, transfer: SettledTransfer): void {
    this.settled.set(hash.toLowerCase(), transfer);
  }

  /** Zodia cannot be asked by hash, so a receipt the adapter did not settle never appears: say so instead of waiting forever. */
  async waitForTransaction(hash: string): Promise<TransactionReceipt | null> {
    const receipt = await this.getTransactionReceipt(hash);
    if (!receipt) throw new Error(`Zodia reports no transaction ${hash}: receipts are known only for transfers this adapter settled`);
    return receipt;
  }

  async _detectNetwork(): Promise<Network> {
    return Network.from(this.chainId);
  }

  async _perform<T = any>(req: PerformActionRequest): Promise<T> {
    switch (req.method) {
      case 'chainId':
        return toQuantity(this.chainId) as T;
      case 'getBlockNumber':
        return '0x0' as T;
      case 'getBalance':
        return toQuantity(await this.balance(req.address, this.native)) as T;
      case 'call':
        return await this.erc20Read(req.transaction) as T;
      case 'getTransactionReceipt':
        return this.receipt(req.hash) as T;
      default:
        throw new Error(`Zodia does not serve '${req.method}': chain reads in Zodia mode are limited to chain id, wallet balances, ERC20 decimals and receipts of the adapter's own transfers`);
    }
  }

  /** The receipt of a transfer this adapter settled; null, as for any provider, for a hash it does not know. */
  private receipt(hash: string): Record<string, unknown> | null {
    const transfer = this.settled.get(hash.toLowerCase());
    if (!transfer) return null;
    return {
      transactionHash: hash,
      blockHash: ZeroHash,
      blockNumber: '0x0',
      transactionIndex: '0x0',
      from: transfer.from,
      to: null,
      contractAddress: null,
      logs: [],
      gasUsed: '0x0',
      cumulativeGasUsed: '0x0',
      effectiveGasPrice: '0x0',
      status: transfer.status ? '0x1' : '0x0',
    };
  }

  private async erc20Read(tx: PerformActionTransaction): Promise<string> {
    const token = tx.to ? String(tx.to) : undefined;
    const call = token && tx.data ? ERC20_READS.parseTransaction({ data: String(tx.data) }) : null;
    if (!token || !call) {
      throw new Error(`Zodia does not serve contract call ${String(tx.data ?? '').slice(0, 10)} on ${token}: only ERC20 balanceOf and decimals`);
    }
    const currency = this.tokens.get(token.toLowerCase());
    if (!currency) throw new Error(`Token ${token} is not mapped to a Zodia currency; add it to ZODIA_TOKEN_CURRENCIES once Zodia lists it`);
    if (call.name === 'decimals') return ERC20_READS.encodeFunctionResult('decimals', [await this.decimals(currency)]);
    return ERC20_READS.encodeFunctionResult('balanceOf', [await this.balance(String(call.args[0]), currency)]);
  }

  /** Available balance, in the currency's smallest unit, of the company wallet holding the address. */
  private async balance(address: string, currency: ZodiaCurrencyRef): Promise<bigint> {
    const walletId = await this.walletIdOf(address);
    if (!walletId) throw new Error(`Zodia holds no wallet for ${address}; balances are known only for the company's wallets`);
    const [wallet] = await this.api.wallets({ ids: [walletId] });
    if (!wallet) throw new Error(`Zodia wallet ${walletId} is not listed`);
    const line = lineOf(wallet, currency);
    if (!line?.availableBalance) return 0n;
    // amountUnit is the exact smallest-unit figure, grouped with commas ("29,527,676,251,739,295");
    // amount is rounded to 8 places, so it is only the fallback
    const { amount, amountUnit } = line.availableBalance;
    const exact = amountUnit?.replace(/,/g, '');
    if (exact !== undefined && /^\d+$/.test(exact)) return BigInt(exact);
    return parseUnits(amount, await this.decimals(currency));
  }

  private async decimals(currency: ZodiaCurrencyRef): Promise<number> {
    const places = await this.decimalsOf(currency);
    if (places === undefined) throw new Error(`Zodia lists no ratio for currency ${currency.currencyId}`);
    return places;
  }
}

/** Zodia spells one code in more than one case: `eth` in its currency list, `ETH` on wallet balances. */
function lineOf(wallet: ZodiaWallet, currency: ZodiaCurrencyRef) {
  return wallet.balances?.find(b => b.currency.toLowerCase() === currency.currency.toLowerCase());
}
