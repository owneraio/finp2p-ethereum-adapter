/**
 * The adapter's plugin integration contract — the single source of truth for
 * what a token-standard plugin implements.
 *
 * This module MUST stay free of adapter runtime imports: plugins consume it
 * type-only (import type) via the package subpath export, so nothing of the
 * adapter's runtime graph ever loads inside a plugin build.
 */
export * from './interface';
export * from './types';
export * from './whitelisting';
