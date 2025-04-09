import { ContractsManager } from "./manager";
import { AddressLike, BigNumberish, ContractFactory, Interface, Provider, Signer } from "ethers";
import { ERC20WithOperator } from "../../typechain-types";
import ERC20 from "../../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";
import winston from "winston";


export class ERC20Contract extends ContractsManager {

  contractInterface: Interface;

  erc20: ERC20WithOperator;

  tokenAddress: AddressLike;

  constructor(provider: Provider, signer: Signer, tokenAddress: AddressLike, logger: winston.Logger) {
    super(provider, signer, logger);
    this.tokenAddress = tokenAddress;
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi, ERC20.bytecode, this.signer
    );
    const contract = factory.attach(tokenAddress as string);
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

  async balanceOf(account: AddressLike) {
    return this.erc20.balanceOf(account);
  }

  async allowance(owner: AddressLike, spender: AddressLike) {
    return this.erc20.allowance(owner, spender);
  }

  async approve(spender: AddressLike, quantity: BigNumberish) {
    return this.erc20.approve(spender, quantity);
  }

  async mint(toAddress: AddressLike, quantity: BigNumberish) {
    return this.erc20.mint(toAddress, quantity);
  }

  async transfer(fromAddress: AddressLike, toAddress: AddressLike, quantity: BigNumberish) {
    return this.erc20.transferFrom(fromAddress, toAddress, quantity);
  }

  async burn(fromAddress: AddressLike, quantity: BigNumberish) {
    return this.erc20.burn(fromAddress, quantity);
  }

  async hasRole(role: string, address: AddressLike) {
    return this.erc20.hasRole(role, address);
  }

  async grantOperatorTo(address: AddressLike) {
    return this.erc20.grantOperatorTo(address);
  }
}