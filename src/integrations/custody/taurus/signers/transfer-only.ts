import { Provider, TransactionDescription, TransactionRequest } from 'ethers';
import { TaurusRequest } from '../client';
import { TaurusSigner } from './base';

/** 'transfer-only' mode: plain transfers as PROTECT-native requests — ERC20
 *  transfers as currency transfers (the live-verified path), native transfers
 *  to whitelisted addresses; everything else a token standard might do is
 *  unsupported. */
export class TaurusTransferOnlySigner extends TaurusSigner {

  connect(provider: Provider): TaurusTransferOnlySigner {
    return new TaurusTransferOnlySigner(provider, this.client, this.config, this.addressId, this.address);
  }

  protected async createRequest(to: string, parsed: TransactionDescription | undefined, tx: TransactionRequest): Promise<TaurusRequest> {
    if (!parsed) {
      const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
      if (!toWhitelistedAddressId) {
        throw new Error(`Taurus signer: ${to} is not a whitelisted address in PROTECT — whitelist it before transacting`);
      }
      return this.client.createTransferRequest({
        fromAddressId: this.addressId,
        toWhitelistedAddressId,
        amount: (tx.value ?? 0n).toString(),
        comment: 'finp2p adapter transfer',
      });
    }
    if (parsed.signature !== 'transfer(address,uint256)') {
      throw new Error(`Taurus signer: ${parsed.name} is not supported in transfer-only mode — token standards require TAURUS_OPERATION_MODE=contract-call`);
    }
    const currency = await this.client.findCurrencyByContract(to);
    if (!currency) {
      throw new Error(`Taurus signer: token ${to} is not a registered PROTECT currency — whitelist and approve the contract before transferring`);
    }
    return this.client.createAddressToAddressTransfer({
      fromAddress: this.address,
      toAddress: String(parsed.args[0]),
      amount: (parsed.args[1] as bigint).toString(),
      currency: currency.symbol,
      comment: 'finp2p adapter token transfer',
    });
  }
}
