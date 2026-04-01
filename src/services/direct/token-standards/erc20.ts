import { ContractTransactionResponse, Provider, Signer } from 'ethers';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import winston from 'winston';
import { CustodyWallet } from '../custody-provider';
import { AssetRecord, DeployResult, TokenStandard } from './interface';

export const ERC20_TOKEN_STANDARD = 'ERC20';

export class ERC20TokenStandard implements TokenStandard {

  async deploy(wallet: CustodyWallet, name: string, symbol: string, decimals: number, logger: winston.Logger): Promise<DeployResult> {
    const cm = new ContractsManager(wallet.provider, wallet.signer, logger);
    const contractAddress = await cm.deployERC20(name, symbol, decimals, await wallet.signer.getAddress());
    return { contractAddress, decimals, tokenStandard: ERC20_TOKEN_STANDARD };
  }

  async balanceOf(provider: Provider, signer: Signer, asset: AssetRecord, address: string, logger: winston.Logger): Promise<bigint> {
    const c = new ERC20Contract(provider, signer, asset.contract_address, logger);
    return c.balanceOf(address);
  }

  async mint(wallet: CustodyWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, logger);
    return c.mint(to, amount);
  }

  async transfer(wallet: CustodyWallet, asset: AssetRecord, to: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, logger);
    return c.transfer(to, amount);
  }

  async burn(wallet: CustodyWallet, asset: AssetRecord, from: string, amount: bigint, logger: winston.Logger): Promise<ContractTransactionResponse> {
    const c = new ERC20Contract(wallet.provider, wallet.signer, asset.contract_address, logger);
    return c.burn(from, amount);
  }
}
