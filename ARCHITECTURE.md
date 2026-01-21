# Fireblocks Dynamic Vault Management Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FireblocksAppConfig                                  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Existing Properties                                              │   │
│  │  - type: 'fireblocks'                                            │   │
│  │  - provider: BrowserProvider                                     │   │
│  │  - signer: JsonRpcSigner                                         │   │
│  │  - fireblocksSdk: FireblocksSDK                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ New Methods (Dynamic Vault Management)                           │   │
│  │                                                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │ getAllVaults()                                             │ │   │
│  │  │   → Fetches all vault accounts from Fireblocks            │ │   │
│  │  │   → Returns: FireblocksVaultAccount[]                     │ │   │
│  │  │   → Cached after first call                               │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │                                                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │ getVaultIdByAddress(ethereumAddress: string)               │ │   │
│  │  │   → Finds which vault owns a specific address             │ │   │
│  │  │   → Returns: { vaultId, assetId } | undefined             │ │   │
│  │  │   → Case-insensitive lookup                               │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │                                                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │ getEthereumVaults()                                        │ │   │
│  │  │   → Filters vaults with Ethereum assets only              │ │   │
│  │  │   → Returns: FireblocksVaultAccount[]                     │ │   │
│  │  │   → Assets filtered by assetId.startsWith('ETH')          │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  │                                                                   │   │
│  │  ┌────────────────────────────────────────────────────────────┐ │   │
│  │  │ getAddressToVaultMapping()                                 │ │   │
│  │  │   → Creates lookup table: address → vault info            │ │   │
│  │  │   → Returns: EthereumAddressToVaultMapping                │ │   │
│  │  │   → Optimized for batch operations                        │ │   │
│  │  └────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     Data Flow Architecture                                │
└─────────────────────────────────────────────────────────────────────────┘

    Application
        │
        │ envVarsToAppConfig(logger)
        ▼
    ┌─────────────────────────┐
    │  Configuration Loading  │
    │                         │
    │ 1. Read env variables   │
    │ 2. Create Fireblocks    │
    │    SDK instance         │
    │ 3. Create provider &    │
    │    signer               │
    └────────┬────────────────┘
             │
             │ createVaultManagementFunctions(fireblocksSdk)
             ▼
    ┌─────────────────────────┐
    │  Vault Management       │
    │  Functions Factory      │
    │                         │
    │ • Initialize cache      │
    │ • Create methods        │
    │ • Return function set   │
    └────────┬────────────────┘
             │
             │ Returns FireblocksAppConfig
             ▼
    ┌─────────────────────────────────────────────┐
    │         Application Usage                    │
    │                                              │
    │  config.getAllVaults()                      │
    │      │                                       │
    │      ├──→ Check cache                       │
    │      │    │                                  │
    │      │    ├─ Cached? Return cached data     │
    │      │    │                                  │
    │      │    └─ Not cached?                    │
    │      │         │                             │
    │      │         └──→ Fireblocks API          │
    │      │              (getVaultAccountsWithPageInfo) │
    │      │                  │                    │
    │      │                  └──→ Parse response │
    │      │                       │               │
    │      │                       └──→ Cache     │
    │      │                            │          │
    │      └────────────────────────────┘          │
    │                                              │
    │  config.getVaultIdByAddress(addr)           │
    │      │                                       │
    │      └──→ getAllVaults()                    │
    │           │                                  │
    │           └──→ Search through vaults        │
    │                │                             │
    │                └──→ Return match or undefined│
    │                                              │
    │  config.getEthereumVaults()                 │
    │      │                                       │
    │      └──→ getAllVaults()                    │
    │           │                                  │
    │           └──→ Filter by assetId            │
    │                │                             │
    │                └──→ Return filtered list    │
    │                                              │
    │  config.getAddressToVaultMapping()          │
    │      │                                       │
    │      └──→ getEthereumVaults()               │
    │           │                                  │
    │           └──→ Build mapping object         │
    │                │                             │
    │                └──→ Return mapping          │
    └─────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     Type Hierarchy                                        │
└─────────────────────────────────────────────────────────────────────────┘

FireblocksVaultAccount
├── id: string
├── name: string
├── assets: FireblocksVaultAsset[]
│   └── FireblocksVaultAsset
│       ├── assetId: string        (e.g., "ETH", "ETH_TEST3")
│       ├── address: string        (Blockchain address)
│       ├── balance?: string
│       ├── availableBalance?: string
│       ├── lockedBalance?: string
│       └── tag?: string
├── hiddenOnUI?: boolean
├── customerRefId?: string
└── autoFuel?: boolean

EthereumAddressToVaultMapping
└── [address: string]: {
        vaultId: string
        assetId: string
    }

┌─────────────────────────────────────────────────────────────────────────┐
│                     Usage Patterns                                        │
└─────────────────────────────────────────────────────────────────────────┘

Pattern 1: Discover All Vaults
──────────────────────────────
const vaults = await config.getAllVaults();
for (const vault of vaults) {
  console.log(`Vault ${vault.id}: ${vault.assets.length} assets`);
}


Pattern 2: Find Vault by Address
─────────────────────────────────
const address = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
const info = await config.getVaultIdByAddress(address);
if (info) {
  console.log(`Use vault ${info.vaultId} for this transaction`);
}


Pattern 3: Work with Ethereum Only
───────────────────────────────────
const ethVaults = await config.getEthereumVaults();
const addresses = ethVaults.flatMap(v => 
  v.assets.map(a => a.address)
);


Pattern 4: Batch Address Lookup
────────────────────────────────
const mapping = await config.getAddressToVaultMapping();
addresses.forEach(addr => {
  const info = mapping[addr.toLowerCase()];
  if (info) processTransaction(info.vaultId);
});

┌─────────────────────────────────────────────────────────────────────────┐
│                     Caching Strategy                                      │
└─────────────────────────────────────────────────────────────────────────┘

Initial State:
   cachedVaults = null

First Call to getAllVaults():
   ┌──────────────────┐
   │ API Call         │ ──→ Fetch from Fireblocks
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │ Store in Cache   │ ──→ cachedVaults = [...]
   └────────┬─────────┘
            │
            ▼
   Return cached data

Subsequent Calls:
   ┌──────────────────┐
   │ Check Cache      │ ──→ Cache exists?
   └────────┬─────────┘
            │ Yes
            ▼
   Return cached data (No API call)

Cache Lifetime:
   • Persists for config instance lifetime
   • To refresh: create new config instance
   • Shared across all vault management methods

┌─────────────────────────────────────────────────────────────────────────┐
│                     Error Handling Flow                                   │
└─────────────────────────────────────────────────────────────────────────┘

getAllVaults()
    │
    ├─ try {
    │    └─ API call
    │       │
    │       ├─ Success → Process & cache
    │       │
    │       └─ Error
    │          │
    │          ├─ Log error
    │          │
    │          └─ Throw with context
    │             "Failed to fetch Fireblocks vaults: [details]"
    │
    └─ catch {
         └─ Propagate to caller
            │
            └─ Caller should handle:
               • Check API credentials
               • Verify network connectivity
               • Check API permissions

┌─────────────────────────────────────────────────────────────────────────┐
│                     Performance Characteristics                           │
└─────────────────────────────────────────────────────────────────────────┘

getAllVaults():
  First call:  O(n) - API call + processing
  Later calls: O(1) - return cached data

getVaultIdByAddress(addr):
  Time: O(n*m) where n=vaults, m=assets per vault
  Space: O(1)
  Uses cached vault data

getEthereumVaults():
  Time: O(n*m) - filter all vaults and assets
  Space: O(k) where k=ethereum vaults
  Uses cached vault data

getAddressToVaultMapping():
  Time: O(n*m) - build complete mapping
  Space: O(p) where p=total ethereum addresses
  Result is cached in calling code for reuse
