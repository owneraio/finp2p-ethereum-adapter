/**
 * Re-export token standard interface and types from the standalone package.
 * Plugin packages depend on @owneraio/finp2p-ethereum-token-standard directly,
 * not on the full adapter.
 */
export { TokenStandard, TokenWallet, AssetRecord, DeployResult } from '@owneraio/finp2p-ethereum-token-standard';
