import { AbstractProvider, Interface, Network, PerformActionRequest, PerformActionTransaction, toQuantity } from 'ethers';
import { TaurusClient } from './client';

const ERC20_READS = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

/**
 * Chain reads served by Taurus PROTECT instead of an RPC node: Taurus
 * broadcasts every transaction itself, so the adapter never submits and needs
 * no NETWORK_HOST. PROTECT answers the chain id and height, the confirmed
 * balances of addresses in custody (native and its currencies), and ERC20
 * decimals; any other read is refused rather than guessed.
 */
export class TaurusChainProvider extends AbstractProvider {

  constructor(private readonly client: TaurusClient, private readonly chainId: bigint) {
    super(Network.from(chainId));
  }

  async _detectNetwork(): Promise<Network> {
    return Network.from(this.chainId);
  }

  async _perform<T = any>(req: PerformActionRequest): Promise<T> {
    switch (req.method) {
      case 'chainId':
        return toQuantity(this.chainId) as T;
      case 'getBlockNumber':
        return toQuantity(await this.client.getBlockHeight()) as T;
      case 'getBalance': {
        const native = await this.client.findNativeCurrencyOrFail();
        return toQuantity(await this.client.getBalance(req.address, native.id)) as T;
      }
      case 'call':
        return await this.erc20Read(req.transaction) as T;
      default:
        throw new Error(`Taurus PROTECT does not serve '${req.method}': chain reads in Taurus mode are limited to chain id, block height, custody balances and ERC20 decimals`);
    }
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
