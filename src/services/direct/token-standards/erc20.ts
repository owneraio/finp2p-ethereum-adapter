import { ContractFactory, Provider, Signer, formatUnits } from 'ethers';
import { ERC20Contract } from '@owneraio/finp2p-contracts';
import ERC20Artifact from '@owneraio/finp2p-contracts/dist/artifacts/contracts/token/ERC20/ERC20.sol/ERC20.json';
import winston from 'winston';
import {
  TokenStandard, TokenWallet, AssetRecord, DeployResult,
  TokenOperationResult, successfulTokenOp, failedTokenOp,
} from '@owneraio/finp2p-ethereum-adapter-contract';

export const ERC20_TOKEN_STANDARD = 'ERC20';

/**
 * Decimals used when the adapter deploys a brand-new ERC20. For bind-to-existing
 * we always read the on-chain `decimals()` instead — never assume.
 */
export const DEFAULT_NEW_ERC20_DECIMALS = 2;

export class ERC20TokenStandard implements TokenStandard {

  async deploy(wallet: TokenWallet, name: string, symbol: string, decimals: number, logger: winston.Logger): Promise<DeployResult> {
    const factory = new ContractFactory(ERC20Artifact.abi, ERC20Artifact.bytecode, wallet.signer);
    const operatorAddress = await wallet.signer.getAddress();
    const contract = await factory.deploy(name, symbol, decimals, operatorAddress);
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
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
    const signerAddress = await wallet.signer.getAddress();
    if (signerAddress.toLowerCase() !== from.toLowerCase()) {
      return failedTokenOp(`burn requires wallet.signer to be ${from}, got ${signerAddress}`);
    }
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contractAddress, logger);
    return this.execAndWait(c.burn(amount));
  }

  async hold(sourceWallet: TokenWallet, escrowWallet: TokenWallet, asset: AssetRecord, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    const escrowAddress = await escrowWallet.signer.getAddress();
    return this.transfer(sourceWallet, asset, escrowAddress, amount, logger);
  }

  async release(escrowWallet: TokenWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<TokenOperationResult> {
    return this.transfer(escrowWallet, asset, to, amount, logger);
  }
}
