import { Provider, TransactionDescription, TransactionRequest } from 'ethers';
import { TaurusRequest } from '../client';
import { RequestExpectation, TaurusSigner } from './base';

/** 'transfer-only' mode: plain transfers as PROTECT-native requests — ERC20
 *  transfers as currency transfers (the live-verified path), native transfers
 *  to internal custody addresses or whitelisted external addresses;
 *  everything else a token standard might do is unsupported. */
export class TaurusTransferOnlySigner extends TaurusSigner {

  connect(provider: Provider): TaurusTransferOnlySigner {
    return new TaurusTransferOnlySigner(provider, this.client, this.config, this.addressId, this.address);
  }

  protected async createRequest(
    to: string, parsed: TransactionDescription | undefined, tx: TransactionRequest, externalRequestId: string | undefined,
  ): Promise<{ request: TaurusRequest; expected: RequestExpectation }> {
    if (!parsed) {
      return this.nativeTransfer(to, (tx.value ?? 0n).toString(), externalRequestId);
    }
    if (parsed.signature !== 'transfer(address,uint256)') {
      throw new Error(`Taurus signer: ${parsed.name} is not supported in transfer-only mode — token standards require TAURUS_OPERATION_MODE=contract-call`);
    }
    const currency = await this.client.findCurrencyByContract(to);
    if (!currency) {
      throw new Error(`Taurus signer: token ${to} is not a registered PROTECT currency on ${this.config.blockchain}/${this.config.network} — whitelist and approve the contract before transferring`);
    }
    const toAddress = String(parsed.args[0]).toLowerCase();
    const amount = (parsed.args[1] as bigint).toString();
    const request = await this.client.createAddressToAddressTransfer({
      fromAddress: this.address.toLowerCase(),
      toAddress,
      amount,
      currency: currency.id,
      comment: 'finp2p adapter token transfer',
      externalRequestId,
    });
    const expected: RequestExpectation = {
      source: this.address.toLowerCase(),
      currencyId: currency.id,
      fn: 'transfer(address,uint256)',
      args: [{ address: toAddress }, { value: amount }],
    };
    return { request, expected };
  }

  /** Internal custody destinations move as native-currency address-to-address
   *  transfers (this is what gas prefunding needs); external destinations
   *  must be in the whitelisted-addresses registry. */
  private async nativeTransfer(
    to: string, amount: string, externalRequestId: string | undefined,
  ): Promise<{ request: TaurusRequest; expected: RequestExpectation }> {
    const source = this.address.toLowerCase();
    const toAddress = to.toLowerCase();

    if (await this.client.findInternalAddress(to)) {
      const native = await this.client.findNativeCurrency();
      if (!native) {
        throw new Error(`Taurus signer: no native currency registered for ${this.config.blockchain}/${this.config.network}`);
      }
      const request = await this.client.createAddressToAddressTransfer({
        fromAddress: source,
        toAddress,
        amount,
        currency: native.id,
        comment: 'finp2p adapter native transfer',
        externalRequestId,
      });
      return { request, expected: { source, destination: toAddress, amount, currencyId: native.id } };
    }

    const toWhitelistedAddressId = await this.client.findWhitelistedAddressId(to);
    if (!toWhitelistedAddressId) {
      throw new Error(`Taurus signer: ${to} is neither an internal custody address nor a whitelisted address in PROTECT — whitelist it before transacting`);
    }
    const request = await this.client.createTransferRequest({
      fromAddressId: this.addressId,
      toWhitelistedAddressId,
      amount,
      comment: 'finp2p adapter transfer',
      externalRequestId,
    });
    return { request, expected: { source, destination: toAddress, amount } };
  }
}
