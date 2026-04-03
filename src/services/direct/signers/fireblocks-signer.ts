import { Provider, Transaction, TransactionRequest, TransactionResponse, keccak256, formatEther } from 'ethers';
import {
  FireblocksSDK,
  TransactionOperation,
  PeerType,
  TransactionStatus,
  TransactionResponse as FBTransactionResponse,
} from 'fireblocks-sdk';
import { CustodySigner } from './custody-signer';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

const TERMINAL_STATES: TransactionStatus[] = [
  TransactionStatus.COMPLETED,
  TransactionStatus.FAILED,
  TransactionStatus.REJECTED,
  TransactionStatus.CANCELLED,
  TransactionStatus.BLOCKED,
  TransactionStatus.TIMEOUT,
];

/**
 * Fireblocks custody signer.
 *
 * Implements signTransaction() using the Fireblocks RAW operation type which
 * signs a hash without broadcasting. The signature (r, s, v) is then attached
 * to the ethers Transaction object to produce the signed serialized tx.
 *
 * sendTransaction() is inherited from AbstractSigner: it calls
 * signTransaction() then provider.broadcastTransaction().
 */
export class FireblocksCustodySigner extends CustodySigner {
  private readonly fireblocksSdk: FireblocksSDK;
  private readonly vaultAccountId: string;
  private readonly assetId: string;

  constructor(
    address: string,
    fireblocksSdk: FireblocksSDK,
    vaultAccountId: string,
    provider: Provider,
    assetId: string = 'ETH_TEST5',
  ) {
    super(address, provider);
    this.fireblocksSdk = fireblocksSdk;
    this.vaultAccountId = vaultAccountId;
    this.assetId = assetId;
  }

  connect(provider: Provider): FireblocksCustodySigner {
    return new FireblocksCustodySigner(
      this._address, this.fireblocksSdk, this.vaultAccountId, provider, this.assetId,
    );
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const pop = await this.populateTransaction(tx);
    const txObj = Transaction.from(pop);
    const unsignedHash = keccak256(txObj.unsignedSerialized);

    // Submit RAW signing request — signs the hash without broadcasting
    const { id } = await this.fireblocksSdk.createTransaction({
      operation: TransactionOperation.RAW,
      assetId: this.assetId,
      source: {
        type: PeerType.VAULT_ACCOUNT,
        id: this.vaultAccountId,
      },
      extraParameters: {
        rawMessageData: {
          messages: [{ content: unsignedHash.slice(2) }], // remove 0x prefix
        },
      },
    });

    // Poll for completion
    const completed = await this.pollTransaction(id);

    // Extract signature from signedMessages
    const signedMsg = completed.signedMessages?.[0];
    if (!signedMsg?.signature) {
      throw new Error(`Fireblocks RAW transaction ${id} completed but has no signature`);
    }

    const { r, s, v } = signedMsg.signature;
    if (!r || !s || v === undefined) {
      throw new Error(`Fireblocks RAW transaction ${id}: incomplete signature (r=${r}, s=${s}, v=${v})`);
    }

    // Attach signature to the transaction and return signed serialization
    txObj.signature = {
      r: '0x' + r,
      s: '0x' + s,
      v,
    };

    return txObj.serialized;
  }

  get supportsCustodySubmit(): boolean {
    return true;
  }

  protected async custodySendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const pop = await this.populateTransaction(tx);
    const to = pop.to as string;
    if (!to) throw new Error('FireblocksCustodySigner: transaction must have a "to" address');

    const hasCalldata = pop.data && pop.data !== '0x';

    const { id } = await this.fireblocksSdk.createTransaction({
      operation: hasCalldata ? TransactionOperation.CONTRACT_CALL : TransactionOperation.TRANSFER,
      assetId: this.assetId,
      source: {
        type: PeerType.VAULT_ACCOUNT,
        id: this.vaultAccountId,
      },
      destination: {
        type: PeerType.ONE_TIME_ADDRESS,
        oneTimeAddress: { address: to },
      },
      amount: pop.value ? formatEther(pop.value) : '0',
      ...(hasCalldata ? { extraParameters: { contractCallData: pop.data } } : {}),
    });

    const completed = await this.pollTransaction(id);
    const txHash = completed.txHash;
    if (!txHash) throw new Error(`Fireblocks transaction ${id} completed but has no txHash`);
    return this.provider!.getTransaction(txHash) as Promise<TransactionResponse>;
  }

  private async pollTransaction(txId: string): Promise<FBTransactionResponse> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const txInfo = await this.fireblocksSdk.getTransactionById(txId);

      if (TERMINAL_STATES.includes(txInfo.status)) {
        if (txInfo.status !== TransactionStatus.COMPLETED) {
          throw new Error(`Fireblocks transaction ${txId} terminal status: ${txInfo.status}`);
        }
        return txInfo;
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Fireblocks transaction ${txId} timed out after ${POLL_TIMEOUT_MS}ms`);
  }

  async signMessage(): Promise<string> {
    throw new Error('FireblocksCustodySigner: signMessage not yet implemented');
  }

  async signTypedData(): Promise<string> {
    throw new Error('FireblocksCustodySigner: signTypedData not yet implemented');
  }
}
