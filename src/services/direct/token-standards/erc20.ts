import { Provider, Signer, formatUnits } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import {
  TokenStandard, TokenWallet, AssetRecord, DeployResult,
  TokenOperationResult, successfulTokenOp, failedTokenOp,
} from '@owneraio/finp2p-ethereum-token-standard';

export const ERC20_TOKEN_STANDARD = 'ERC20';

export class ERC20TokenStandard implements TokenStandard {

  async deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number, logger: winston.Logger): Promise<DeployResult> {
    const cm = new ContractsManager(wallet.provider, wallet.signer, logger);
    const contractAddress = await cm.deployERC20(name, symbol, decimals, await wallet.signer.getAddress());
    return { contractAddress, decimals, tokenStandard: ERC20_TOKEN_STANDARD };
  }

  async balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: winston.Logger): Promise<string> {
    const c = new ERC20Contract(provider, signer, asset.contractAddress, logger);
    const balance = await c.balanceOf(address);
    return formatUnits(balance, asset.decimals);
  }

  private async execAndWait(txPromise: Promise<any>): Promise<TokenOperationResult> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) return failedTokenOp('Transaction failed or receipt is null');
    const block = await receipt.getBlock();
    return successfulTokenOp(receipt.hash, block?.timestamp ?? Math.floor(Date.now() / 1000));
  }

  async mint(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contractAddress, logger);
    return this.execAndWait(c.mint(to, amount));
  }

  async transfer(wallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contractAddress, logger);
    return this.execAndWait(c.transfer(to, amount));
  }

  async burn(wallet: TokenWallet, asset: AssetRecord, from: string, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contractAddress, logger);
    return this.execAndWait(c.burn(from, amount));
  }

  async hold(sourceWallet: TokenWallet, escrowWallet: TokenWallet, asset: AssetRecord, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    const escrowAddress = await escrowWallet.signer.getAddress();
    return this.transfer(sourceWallet, asset, escrowAddress, amount, logger);
  }

  async release(escrowWallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    return this.transfer(escrowWallet, asset, to, amount, logger);
  }
}
