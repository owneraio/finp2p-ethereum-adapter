import { ContractsManager } from "./manager";
import { Logger } from "@owneraio/finp2p-adapter-models";
import { BigNumberish, ContractFactory, Interface, keccak256, Provider, Signer, toUtf8Bytes } from "ethers";
import { ERC20WithOperator } from "../typechain-types";
import ERC20 from "../artifacts/contracts/token/ERC20/ERC20WithOperator.sol/ERC20WithOperator.json";

export const OPERATOR_ROLE = keccak256(toUtf8Bytes('OPERATOR_ROLE'));
export const MINTER_ROLE = keccak256(toUtf8Bytes('MINTER_ROLE'));

export class ERC20Contract extends ContractsManager {

  contractInterface: Interface;

  erc20: ERC20WithOperator;

  tokenAddress: string;

  constructor(provider: Provider, signer: Signer, tokenAddress: string, logger: Logger) {
    super(provider, signer, logger);
    this.tokenAddress = tokenAddress;
    const factory = new ContractFactory<any[], ERC20WithOperator>(
      ERC20.abi, ERC20.bytecode, this.signer
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

  async allowance(owner: string, spender: string) {
    return this.erc20.allowance(owner, spender);
  }

  async approve(spender: string, quantity: BigNumberish) {
    return this.erc20.approve(spender, quantity);
  }

  async mint(toAddress: string, quantity: BigNumberish) {
    return this.erc20.mint(toAddress, quantity);
  }

  async transfer(toAddress: string, quantity: BigNumberish) {
    return this.erc20.transfer( toAddress, quantity);
  }

  async transferFrom(fromAddress: string, toAddress: string, quantity: BigNumberish) {
    return this.erc20.transferFrom(fromAddress, toAddress, quantity);
  }

  async burn(fromAddress: string, quantity: BigNumberish) {
    return this.erc20.burn(fromAddress, quantity);
  }

  async hasRole(role: string, address: string) {
    return this.erc20.hasRole(role, address);
  }

  async grantOperatorTo(address: string) {
    return this.erc20.grantOperatorTo(address);
  }

  async grantMinterTo(address: string) {
    return this.erc20.grantMinterTo(address);
  }
}
