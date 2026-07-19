/**
 * The adapter's plugin SPI — the single source of truth for what a
 * token-standard plugin implements. A standalone runtime package: besides the
 * interfaces it carries the values plugins use at runtime (token-op helpers
 * and the LegType/PrimaryType/Phase/ReleaseType enums), so plugins declare it
 * as a peerDependency (plus devDependency for local builds).
 *
 * This package must stay tiny and free of adapter runtime imports — its only
 * dependency is ethers, used for types alone.
 */
export * from './interface';
export * from './types';
export * from './whitelisting';
