import {
  ContractFactory,
  ContractTransactionResponse,
  Interface,
  Provider,
  Signer,
  TypedDataField
} from "ethers";
import FINP2P
  from '../../artifacts/contracts/token/ERC20/FINP2POperatorERC20.sol/FINP2POperatorERC20.json';
import { FINP2POperatorERC20 } from "../../typechain-types";
import {
  detectError, EIP712Domain,
  EthereumTransactionError,
  FinP2PReceipt,
  NonceAlreadyBeenUsedError,
  NonceToHighError,
  OperationStatus
} from "./model";
import { compactSerialize, normalizeOperationId, parseTransactionReceipt } from "./utils";
import { ContractsManager } from './manager';
import { LegType, PrimaryType, sign, hash as typedHash, Term } from "./eip712";
import winston from "winston";

export class FinP2PContract extends ContractsManager {

  contractInterface: Interface;

  finP2P: FINP2POperatorERC20;

  finP2PContractAddress: string;

  constructor(provider: Provider, signer: Signer, finP2PContractAddress: string, logger: winston.Logger) {
    super(provider, signer, logger);
    const factory = new ContractFactory<any[], FINP2POperatorERC20>(
      FINP2P.abi, FINP2P.bytecode, this.signer,
    );
    const contract = factory.attach(finP2PContractAddress);
    this.contractInterface = contract.interface;
    this.finP2P = contract as FINP2POperatorERC20;
    this.finP2PContractAddress = finP2PContractAddress;
    this.signer.getNonce().then((nonce) => {
      this.logger.info(`Syncing nonce: ${nonce}`);
    });
  }

  async eip712Domain(): Promise<EIP712Domain> {
    const domain = await this.finP2P.eip712Domain();
    if (domain === null) {
      throw new Error('Failed to get EIP712 domain');
    }
    if (domain.length < 5) {
      throw new Error('Invalid EIP712 domain');
    }
    const name = domain[1];
    const version = domain[2];
    const chainId = parseInt(`${domain[3]}`);
    const verifyingContract = domain[4];
    return { name, version, chainId, verifyingContract };
  }

  async getAssetAddress(assetId: string) {
    return this.finP2P.getAssetAddress(assetId);
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.associateAsset(assetId, tokenAddress);
    });
  }

  async issue(issuerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.issue(issuerFinId, asset);
    });
  }

  async transfer(nonce: string, sellerFinId: string, buyerFinId: string,
                 asset: Term, settlement: Term, leg: LegType, eip712PrimaryType: PrimaryType, signature: string) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.transfer(
        nonce, sellerFinId, buyerFinId, asset, settlement, leg, eip712PrimaryType, `0x${signature}`);
    });
  }

  async redeem(ownerFinId: string, asset: Term) {
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.redeem(ownerFinId, asset);
    });
  }

  async hold(operationId: string, nonce: string, sellerFinId: string, buyerFinId: string,
             asset: Term, settlement: Term, leg: LegType, eip712PrimaryType: PrimaryType, signature: string) {
    const opId = normalizeOperationId(operationId);
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.hold(opId, nonce, sellerFinId, buyerFinId, asset, settlement, leg, eip712PrimaryType, `0x${signature}`);
    });
  }

  async release(operationId: string, buyerFinId: string, quantity: string, leg: LegType) {
    const opId = normalizeOperationId(operationId);
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.release(opId, buyerFinId, quantity, leg);
    });
  }

  async withholdRedeem(operationId: string, ownerFinId: string, quantity: string, leg: LegType) {
    const opId = normalizeOperationId(operationId);
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.withholdRedeem(opId, ownerFinId, quantity, leg);
    });
  }

  async rollback(operationId: string, leg: LegType) {
    const opId = normalizeOperationId(operationId);
    return this.safeExecuteTransaction(async (finP2P: FINP2POperatorERC20) => {
      return finP2P.rollback(opId, leg);
    });
  }

  async balance(assetId: string, finId: string) {
    return this.finP2P.getBalance(assetId, finId);
  }

  async hasRole(role: string, address: string) {
    return this.finP2P.hasRole(role, address);
  }

  async grantTransactionManagerRoleTo(to: string) {
    await this.finP2P.grantTransactionManagerRole(to);
  }

  async getEIP712Domain() {
    return this.finP2P.eip712Domain();
  }

  async signEIP712(chainId: bigint | number, verifyingContract: string, types: Record<string, Array<TypedDataField>>, message: Record<string, any>) : Promise<{ hash: string, signature: string}> {
    const hash = typedHash(chainId, verifyingContract, types, message).substring(2);
    const signature = compactSerialize(await sign(chainId, verifyingContract, types, message, this.signer));
    return { hash, signature };
  }

  async getOperationStatus(hash: string): Promise<OperationStatus> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      return {
        status: 'pending',
      };
    } else if (txReceipt?.status === 1) {
      let receipt = parseTransactionReceipt(txReceipt, this.contractInterface);
      if (receipt === null) {
        this.logger.error('Failed to parse receipt');
        return {
          status: 'failed',
          error: {
            code: 1,
            message: 'Operation failed',
          },
        };
      }
      return {
        status: 'completed',
        receipt: receipt,
      };
    } else {
      return {
        status: 'failed',
        error: {
          code: 1,
          message: 'Operation failed',
        },
      };
    }
  }

  async getReceipt(hash: string): Promise<FinP2PReceipt> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      throw new Error('Transaction not found');
    }
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface);
    if (receipt === null) {
      throw new Error('Failed to parse receipt');
    }
    return receipt;
  }

  private async safeExecuteTransaction(call: (finp2p: FINP2POperatorERC20) => Promise<ContractTransactionResponse>, maxAttempts: number = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await call(this.finP2P);
        return response.hash;
      } catch (e) {
        const err = detectError(e);
        if (err instanceof EthereumTransactionError) {
          // console.log('Ethereum transaction error');
          this.resetNonce();
          throw err;

        } else if (err instanceof NonceToHighError) {
          // console.log('Nonce too high error, retrying');
          this.resetNonce();
          // continuing the loop
        } else if (err instanceof NonceAlreadyBeenUsedError) {
          // console.log('Nonce already been used error, retrying');
          this.resetNonce();
          // continuing the loop
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed to execute transaction without nonce-too-high error after ${maxAttempts} attempts`);
  }
}
