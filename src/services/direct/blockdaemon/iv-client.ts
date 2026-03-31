/**
 * Blockdaemon Institutional Vault API client.
 * Types based on openapi.yaml v2.0.0
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface Metadata {
  id: number;
  name: string;
  creatorID: number;
  creatorEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceValue { available: string; onChain: string }
export interface BalanceCrypto { value: BalanceValue; unit: string }
export interface Balance { crypto?: BalanceCrypto; usd?: BalanceValue }

export interface AddressToken { isActive: boolean; symbol: string }

export interface AddressConfig {
  accountID: number;
  protocol: string;
  network: string;
  address: string;
  tokens: AddressToken[];
}

export interface IVAddress {
  metadata: Metadata;
  config: AddressConfig;
}

export interface AssetConfig {
  contractAddress?: string;
  network: string;
  protocol: string;
  symbol?: string;
}

export interface Asset {
  metadata: Metadata;
  config: AssetConfig;
  status?: { balance?: Balance; isWalletConnectable?: boolean; status?: string };
}

export interface AccountAsset {
  asset: Asset;
  addresses: IVAddress[];
  balance: Balance;
}

export interface AccountConfig {
  isCold: boolean;
  isActive: boolean;
  assets?: AccountAsset[];
}

export interface Account {
  metadata: Metadata;
  config: AccountConfig;
  status?: { balance?: Balance; status?: string };
}

export interface AccountList { list: Account[]; more: boolean }
export interface AssetList { list: Asset[]; more: boolean }
export interface AddressList { list: IVAddress[]; more: boolean }

export interface EVMSpec {
  Gas?: string;
  MaxFeePerGas?: string;
  MaxPriorityFeePerGas?: string;
  Nonce?: string;
}

export interface BlockchainSpec { evm?: EVMSpec }

export interface ToAddressAmount {
  address: string;
  accountID?: number;
  amount?: string;
  calldata?: string;
}

export interface FromAddressAmount {
  address: string;
  accountID?: number;
  amount: string;
}

export interface TransferPost {
  type: 'transfer' | 'contract';
  assetID: number;
  toAddressAmountArray: ToAddressAmount[];
  fromAddressAmountArray: FromAddressAmount[];
  feePriority?: 'Custom' | 'High' | 'Low' | 'Medium';
  blockchainSpec?: BlockchainSpec;
  reference?: string;
}

export interface TransferStatus {
  blockNumber?: number;
  txHash?: string;
  status?: string;
  fee?: string;
}

export interface Transfer {
  metadata: Metadata;
  config: {
    type: string;
    assetID: number;
    toAddressAmountArray: ToAddressAmount[];
    fromAddressAmountArray: FromAddressAmount[];
    reference?: string;
  };
  status?: TransferStatus;
}

export interface Transaction {
  metadata: Metadata;
  config: { type: string; transfer?: Transfer['config'] };
  status?: TransferStatus;
}

export interface TransactionList { list: Transaction[]; more: boolean }

export interface AssetPost { protocol: string; network: string; contractAddress: string }

export interface OperationState {
  status: string;
  errorDetails?: { errorCode: string };
  outputs?: {
    transaction?: { id: string; fee?: string; signedTransaction?: string };
  };
}

// ── Client ─────────────────────────────────────────────────────────────

export class InstitutionalVaultClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': this.apiKey,
      'Accept': 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`IV API ${method} ${path} failed (${res.status}): ${text}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Accounts ──

  listAccounts(): Promise<AccountList> {
    return this.request('GET', '/api/v2/accounts');
  }

  getAccount(accountID: number): Promise<Account> {
    return this.request('GET', `/api/v2/accounts/${accountID}`);
  }

  createAccount(name: string, config: { isCold: boolean; isActive: boolean }): Promise<Account> {
    return this.request('POST', '/api/v2/accounts', { name, config });
  }

  addAssetToAccount(accountID: number, assetID: number): Promise<AccountAsset> {
    return this.request('POST', `/api/v2/accounts/${accountID}/assets`, { assetID });
  }

  // ── Addresses ──

  listAddresses(params?: { accountID?: number; assetID?: number }): Promise<AddressList> {
    const query = new URLSearchParams();
    if (params?.accountID !== undefined) query.set('accountID', String(params.accountID));
    if (params?.assetID !== undefined) query.set('assetID', String(params.assetID));
    const qs = query.toString();
    return this.request('GET', `/api/v2/addresses${qs ? '?' + qs : ''}`);
  }

  // ── Assets ──

  listAssets(): Promise<AssetList> {
    return this.request('GET', '/api/v2/assets');
  }

  createAsset(post: AssetPost): Promise<Asset> {
    return this.request('POST', '/api/v2/assets', post);
  }

  // ── Transfers ──

  createTransfer(post: TransferPost): Promise<Transfer> {
    return this.request('POST', '/api/v2/transfers', post);
  }

  // ── Transactions ──

  getTransaction(transactionID: number): Promise<Transaction> {
    return this.request('GET', `/api/v2/transactions/${transactionID}`);
  }

  // ── Operations ──

  getOperation(operationID: string): Promise<OperationState> {
    return this.request('GET', `/api/v2/operations/${operationID}`);
  }
}
