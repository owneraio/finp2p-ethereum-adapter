import { ContractsManager } from "./manager";
import { ContractFactory, Interface, Provider, Signer } from "ethers";
import { ERC20WithOperator, FINP2POperatorERC20 } from "../../typechain-types";
import console from "console";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import { HashType } from "./model";


export class ERC20Contract extends ContractsManager {

  contractInterface: Interface;

  erc20: ERC20WithOperator;

  tokenAddress: string;

  constructor(provider: Provider, signer: Signer, tokenAddress: string) {
    super(provider, signer);
    this.tokenAddress = tokenAddress;
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi, ERC20.bytecode, this.signer,
    );
    const contract = factory.attach(tokenAddress);
    this.contractInterface = contract.interface;
    this.erc20 = contract as ERC20WithOperator;
  }

  async name() {
    return this.erc20.name();
  }

  async symbol() {
    return this.erc20.symbol();
  }

  async decimals() {
    return this.erc20.decimals();
  }

  async totalSupply() {
    return this.erc20.totalSupply();
  }

  async balanceOf(account: string) {
    return this.erc20.balanceOf(account);
  }

  async approve(spender: string, quantity: number) {
      return this.erc20.approve(spender, quantity);
  }

  async mint(toAddress: string, quantity: number) {
      return this.erc20.mint(toAddress, quantity);
  }

  async transfer(fromAddress: string, toAddress: string, quantity: number) {
    return this.erc20.transferFrom(fromAddress, toAddress, quantity);
  }

  async burn(fromAddress: string, quantity: number) {
    return this.erc20.burn(fromAddress, quantity);
  }
}