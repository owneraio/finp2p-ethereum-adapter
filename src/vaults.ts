import { FireblocksSDK, PeerType, TransactionOperation, TransactionStatus } from "fireblocks-sdk"
import axios from 'axios'
import { setTimeout as sleep } from 'node:timers/promises'

async function retryIfRateLimited<T>(apiCall: () => Promise<T>, retryCount: number = 30): Promise<T> {
  try {
    const response = await apiCall()
    return response
  } catch (error) {
    if (axios.isAxiosError(error) && error.status === 429 && retryCount > 0) {
      const sleepCount = Number(error.response?.headers["retry-after"]) ?? 1000
      await sleep(sleepCount)
      return retryIfRateLimited(apiCall, retryCount - 1)
    } else {
      throw error
    }
  }
}

async function autoPaginate<T, R extends { paging?: { after?: string } }>(
  logPrefix: string,
  apiCall: (after: string | undefined) => Promise<R>,
  extractor: (response: R) => T[],
  retryCountIfRateLimited?: number,
): Promise<T[]> {
  const collected: T[] = []

  let after: string | undefined
  while (true) {
    const response = await retryIfRateLimited(() => apiCall(after), retryCountIfRateLimited)
    if (!response) {
      console.error(`${logPrefix}: Autopaginate couldn't get response after ${after}`)
      break
    }

    after = response.paging?.after
    const extracted = extractor(response)
    collected.push(...extracted)

    if (extracted.length === 0 || after === undefined) break
  }

  return collected
}

async function transferAssetFromVaultToVault(fireblocksSdk: FireblocksSDK, fromVaultId: string, toVaultId: string, assetId: string, amount: string): Promise<void> {
  const transaction = await fireblocksSdk.createTransaction({
    operation: TransactionOperation.TRANSFER,
    assetId,
    source: {
      type: PeerType.VAULT_ACCOUNT,
      id: fromVaultId
    },
    destination: {
      type: PeerType.VAULT_ACCOUNT,
      id: toVaultId
    },
    amount,
    note: 'Gas funding for transactions'
  })

  while (true) {
    const txInfo = await fireblocksSdk.getTransactionById(transaction.id)
    const shouldErrorStatuses: TransactionStatus[] = [
      TransactionStatus.FAILED,
      TransactionStatus.BLOCKED,
      TransactionStatus.CANCELLED,
      TransactionStatus.REJECTED,
    ]

    if (txInfo.status === TransactionStatus.COMPLETED) {
      return
    } else if (shouldErrorStatuses.includes(txInfo.status)) {
      throw new Error(`Failed status during gas funding: ${txInfo.status}, id: ${transaction.id}`)
    } else {
      await sleep(3000)
    }
  }
}

export interface FlattenedVaultDetails { vaultId: string, assetId: string, depositAddress: string, assetAddress: string | undefined }

export const createVaultManagementFunctions = (fireblocksSdk: FireblocksSDK) => {

  const fetchAllVaults = () => autoPaginate(
    'getVaults',
    (after) => fireblocksSdk.getVaultAccountsWithPageInfo({ after }),
    (response) => response.accounts
  )

  // Leaf caches: O(1) lookups for already-discovered address -> vault mappings
  const addressLeafCache = new Map<string, FlattenedVaultDetails>()
  const compositeLeafCache = new Map<string, FlattenedVaultDetails>()

  // Shared scan promise to deduplicate concurrent rescan requests
  let activeScanPromise: Promise<FlattenedVaultDetails[]> | null = null

  const scanVaults = async (): Promise<FlattenedVaultDetails[]> => {
    const collectedAddresses: FlattenedVaultDetails[] = []
    const vaults = await fetchAllVaults()
    for (const vault of vaults) {
      for (const asset of (vault.assets ?? [])) {
        const resp = await retryIfRateLimited(() => fireblocksSdk.getDepositAddresses(vault.id, asset.id))
        const assetDetails = await retryIfRateLimited(() => fireblocksSdk.getAssetById(asset.id))
        for (const addr of resp) {
          const detail: FlattenedVaultDetails = {
            vaultId: vault.id,
            assetId: asset.id,
            assetAddress: assetDetails.onchain?.address,
            depositAddress: addr.address,
          }

          collectedAddresses.push(detail)
          addressLeafCache.set(addr.address.toLowerCase(), detail)
          if (detail.assetAddress) {
            compositeLeafCache.set(
              `${addr.address.toLowerCase()}:${detail.assetAddress.toLowerCase()}`,
              detail,
            )
          }
        }
      }
    }
    return collectedAddresses
  }

  // Perform a full scan, deduplicating concurrent requests into a single scan
  const rescan = (): Promise<FlattenedVaultDetails[]> => {
    if (!activeScanPromise) {
      activeScanPromise = scanVaults().finally(() => {
        activeScanPromise = null
      })
    }
    return activeScanPromise
  }

  let initialScanComplete = false
  const ensureInitialScan = async (): Promise<void> => {
    if (!initialScanComplete) {
      await rescan()
      initialScanComplete = true
    }
  }

  const getCollectedAddresses: () => Promise<FlattenedVaultDetails[]> = async () => {
    await ensureInitialScan()
    return Array.from(addressLeafCache.values())
  }

  const getVaultIdForAddress = async (address: string): Promise<string | undefined> => {
    await ensureInitialScan()
    const key = address.toLowerCase()

    // Fast leaf lookup
    const cached = addressLeafCache.get(key)
    if (cached) return cached.vaultId

    // Leaf not discovered yet - rescan to find new vault/address pairs
    await rescan()
    return addressLeafCache.get(key)?.vaultId
  }

  const getVaultAssetBalance = async (vaultId: string, assetId: string): Promise<string | undefined> => {
    const asset = await retryIfRateLimited(() => fireblocksSdk.getVaultAccountAsset(vaultId, assetId))
    return asset.available
  }

  const balance = async (depositAddress: string, tokenAddress: string): Promise<string | undefined> => {
    console.debug('balance requested', depositAddress, tokenAddress)
    await ensureInitialScan()

    const compositeKey = `${depositAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`

    // Fast leaf lookup
    let detail = compositeLeafCache.get(compositeKey)
    if (!detail) {
      // Leaf not discovered yet - rescan to find new entries
      await rescan()
      detail = compositeLeafCache.get(compositeKey)
    }

    if (!detail) return undefined

    console.debug('flatten debug', detail)
    return getVaultAssetBalance(detail.vaultId, detail.assetId)
  }

  return {
    getCollectedAddresses,
    getVaultIdForAddress,
    getVaultAssetBalance,
    balance,
    transferAssetFromVaultToVault,
  }
};
