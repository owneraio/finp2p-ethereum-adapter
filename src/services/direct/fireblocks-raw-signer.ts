import { AbstractSigner, Provider, Signer, Transaction, TransactionLike, TransactionRequest, TypedDataDomain, TypedDataField, keccak256, Signature, recoverAddress, getBytes, hashMessage, TypedDataEncoder } from 'ethers';
import { FireblocksSDK, PeerType, TransactionOperation, TransactionStatus, SigningAlgorithm } from 'fireblocks-sdk';

const TERMINAL_STATUSES = new Set([
  TransactionStatus.COMPLETED,
  TransactionStatus.FAILED,
  TransactionStatus.REJECTED,
  TransactionStatus.CANCELLED,
  TransactionStatus.BLOCKED,
]);

const POLL_INTERVAL_MS = 1000;

export interface FireblocksRawSignerConfig {
  fireblocksSdk: FireblocksSDK;
  vaultAccountId: string;
  assetId?: string;
}

/**
 * An ethers Signer that uses Fireblocks raw signing API for signing
 * and a local provider for transaction submission.
 * Does not require FireblocksWeb3Provider or FIREBLOCKS_CHAIN_ID.
 */
export class FireblocksRawSigner extends AbstractSigner {

  private readonly sdk: FireblocksSDK;
  private readonly vaultAccountId: string;
  private readonly assetId: string;
  private cachedAddress?: string;

  constructor(config: FireblocksRawSignerConfig, provider: Provider) {
    super(provider);
    this.sdk = config.fireblocksSdk;
    this.vaultAccountId = config.vaultAccountId;
    this.assetId = config.assetId ?? 'ETH';
  }

  connect(provider: Provider): Signer {
    return new FireblocksRawSigner({
      fireblocksSdk: this.sdk,
      vaultAccountId: this.vaultAccountId,
      assetId: this.assetId,
    }, provider);
  }

  async getAddress(): Promise<string> {
    if (!this.cachedAddress) {
      const addresses = await this.sdk.getDepositAddresses(this.vaultAccountId, this.assetId);
      if (addresses.length === 0) {
        throw new Error(`No deposit address found for vault ${this.vaultAccountId} asset ${this.assetId}`);
      }
      this.cachedAddress = addresses[0].address;
    }
    return this.cachedAddress;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const populated = await this.populateTransaction(tx);
    const unsignedTx = Transaction.from(populated as TransactionLike);
    const txHash = keccak256(unsignedTx.unsignedSerialized);
    const sig = await this.rawSign(txHash);
    unsignedTx.signature = sig;
    return unsignedTx.serialized;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const hash = hashMessage(message);
    const sig = await this.rawSign(hash);
    return Signature.from(sig).serialized;
  }

  async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
    const hash = TypedDataEncoder.hash(domain, types, value);
    const sig = await this.rawSign(hash);
    return Signature.from(sig).serialized;
  }

  private async rawSign(hash: string): Promise<{ r: string; s: string; v: number }> {
    const content = hash.startsWith('0x') ? hash.slice(2) : hash;

    const { id } = await this.sdk.createTransaction({
      operation: TransactionOperation.RAW,
      source: {
        type: PeerType.VAULT_ACCOUNT,
        id: this.vaultAccountId,
      },
      assetId: this.assetId,
      extraParameters: {
        rawMessageData: {
          messages: [{ content }],
          algorithm: SigningAlgorithm.MPC_ECDSA_SECP256K1,
        },
      },
    });

    const result = await this.pollTransaction(id);
    const signed = result.signedMessages?.[0];
    if (!signed?.signature) {
      throw new Error(`Fireblocks raw signing failed: tx ${id} status ${result.status}, subStatus ${result.subStatus}`);
    }

    const { r, s, v } = signed.signature;
    if (!r || !s || v === undefined) {
      throw new Error(`Incomplete signature from Fireblocks: ${JSON.stringify(signed.signature)}`);
    }

    return { r: `0x${r}`, s: `0x${s}`, v: v + 27 };
  }

  private async pollTransaction(txId: string) {
    while (true) {
      const tx = await this.sdk.getTransactionById(txId);
      if (TERMINAL_STATUSES.has(tx.status as TransactionStatus)) {
        if (tx.status !== TransactionStatus.COMPLETED) {
          throw new Error(`Fireblocks transaction ${txId} ended with status: ${tx.status} (${tx.subStatus})`);
        }
        return tx;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
