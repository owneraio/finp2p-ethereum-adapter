import { FireblocksSDK, VaultAccountResponse } from "fireblocks-sdk"
import axios from 'axios'
import { setTimeout as sleep } from 'node:timers/promises'

function ttlCached<T>(ms: number, method: () => T): () => T {
  let lastTimestampMs = -1
  let lastValue: T | null = null

  return () => {
    if (lastValue !== null && Date.now() - lastTimestampMs > ms) {
      return lastValue
    }

    const currentValue = method()
    lastTimestampMs = Date.now()
    lastValue = currentValue
    return currentValue
  }
}

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

export interface FlattenedVaultDetails { vaultId: string, assetId: string, depositAddress: string, assetAddress: string | undefined }

export const createVaultManagementFunctions = (fireblocksSdk: FireblocksSDK, options: { cacheValuesTtlMs: number }) => {

  const fetchAllVaults = ttlCached(
    options.cacheValuesTtlMs,
    () => autoPaginate(
      'getVaults',
      (after) => fireblocksSdk.getVaultAccountsWithPageInfo({ after }),
      (response) => response.accounts
    )
  )

  const getCollectedAddresses: () => Promise<FlattenedVaultDetails[]> = ttlCached(
    options.cacheValuesTtlMs,
    async () => {
      const collectedAddresses: FlattenedVaultDetails[] = []
      const vaults = await fetchAllVaults()
      for (const vault of vaults) {
        for (const asset of (vault.assets ?? [])) {
          const resp = await retryIfRateLimited(() => fireblocksSdk.getDepositAddresses(vault.id, asset.id))
          const assetDetails = await retryIfRateLimited(() => fireblocksSdk.getAssetById(asset.id))
          for (const addr of resp) {
            collectedAddresses.push({ vaultId: vault.id, assetId: asset.id, assetAddress: assetDetails.onchain?.address, depositAddress: addr.address })
          }
        }
      }
      return collectedAddresses
    }
  )

  const getVaultIdForAddress = async (address: string): Promise<string | undefined> => {
    const collectedAddresses = await getCollectedAddresses()
    return collectedAddresses.find(v => v.depositAddress.toLowerCase() === address.toLowerCase())?.vaultId
  }

  const balance = async (depositAddress: string, tokenAddress: string): Promise<string | undefined> => {
    const vaults = await fetchAllVaults()
    const collectedAddresses = await getCollectedAddresses()

    const flattenedVaultDetail = collectedAddresses.find(v => v.assetAddress?.toLowerCase() === tokenAddress.toLowerCase())
    if (flattenedVaultDetail === undefined) return undefined

    const asset = await retryIfRateLimited(() => fireblocksSdk.getVaultAccountAsset(flattenedVaultDetail.vaultId, flattenedVaultDetail.assetId))
    return asset.available
  }

  return {
    fetchAllVaults,
    getCollectedAddresses,
    getVaultIdForAddress,
    balance,
  }
};
