import { Provider, TransactionDescription, TransactionRequest } from 'ethers';
import { ContractArg, ContractCall, TaurusRequest } from './client';
import { TaurusSigner, TOKEN_CONTRACT_ABI } from './signer';

/** 'contract-call' mode: contract calls ONLY. The token standard's contract
 *  call IS the operation, submitted structurally against the
 *  whitelisted-ADDRESSES registry (contracts/call does not resolve
 *  whitelisted-contract ids); a transaction without calldata is refused. */
export class TaurusContractCallSigner extends TaurusSigner {

  connect(provider: Provider): TaurusContractCallSigner {
    return new TaurusContractCallSigner(provider, this.client, this.config, this.addressId, this.address);
  }

  protected async createRequest(to: string, parsed: TransactionDescription | undefined, tx: TransactionRequest): Promise<TaurusRequest> {
    if (!parsed) {
      throw new Error('Taurus signer: contract-call mode submits contract calls only — native transfers are not supported');
    }
    const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
    if (!toWhitelistedAddressId) {
      throw new Error(`Taurus signer: contract ${to} is not in the PROTECT whitelisted-addresses registry — contract calls require the contract whitelisted as an address`);
    }
    return this.client.createContractCallRequest({
      fromAddressId: this.addressId,
      toWhitelistedAddressId,
      method: toContractCall(parsed),
      amount: tx.value !== undefined && tx.value !== null ? tx.value.toString() : undefined,
      gasLimit: tx.gasLimit?.toString(),
      comment: 'finp2p adapter contract call',
    });
  }
}

function toContractCall(parsed: TransactionDescription): ContractCall {
  const args: ContractArg[] = parsed.fragment.inputs.map((input, i) => ({
    name: input.name || `arg_${i + 1}`,
    type: input.type,
    value: { primitive: String(parsed.args[i]) },
  }));
  return { functionSignature: parsed.signature, args };
}

/** Decode calldata into PROTECT's structured ContractCall ({name, type,
 *  value: {primitive}} per argument); unknown selectors are refused —
 *  mis-translating a call is worse than failing it. */
export function decodeToContractCall(data: string): ContractCall {
  const parsed = TOKEN_CONTRACT_ABI.parseTransaction({ data });
  if (!parsed) {
    throw new Error(`Taurus signer: calldata selector ${data.slice(0, 10)} is not part of the frozen token-contract model — PROTECT accepts structured calls only`);
  }
  return toContractCall(parsed);
}
