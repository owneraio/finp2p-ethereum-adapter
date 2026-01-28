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

export const createVaultManagementFunctions = (fireblocksSdk: FireblocksSDK, options: { cacheValuesTtlMs: number }) => {

  const fetchAllVaults = ttlCached(
    options.cacheValuesTtlMs,
    () => autoPaginate(
      'getVaults',
      (after) => fireblocksSdk.getVaultAccountsWithPageInfo({ after }),
      (response) => response.accounts
    )
  )

  const getCollectedAddresses: () => Promise<{ vaultId: string, assetId: string, address: string }[]> = ttlCached(
    options.cacheValuesTtlMs,
    async () => {
      const collectedAddresses: { vaultId: string, assetId: string, address: string }[] = []
      const vaults = await fetchAllVaults()
      for (const vault of vaults) {
        for (const asset of (vault.assets ?? [])) {
          const resp = await retryIfRateLimited(() => fireblocksSdk.getDepositAddresses(vault.id, asset.id))
          for (const addr of resp) {
            collectedAddresses.push({ vaultId: vault.id, assetId: asset.id, address: addr.address })
          }
        }
      }
      return collectedAddresses
    }
  )

  const getVaultIdForAddress = async (address: string): Promise<string | undefined> => {
    const collectedAddresses = await getCollectedAddresses()
    return collectedAddresses.find(v => v.address.toLowerCase() === address.toLowerCase())?.vaultId
  }

  return {
    fetchAllVaults,
    getCollectedAddresses,
    getVaultIdForAddress,
  }
};
