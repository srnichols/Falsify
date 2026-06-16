/**
 * Falsify — public entry point.
 *
 * Falsify's core algorithm is the Cycle of Scientific Enterprise. It does not
 * return plain answers; it returns falsifiable hypotheses with explicit test
 * conditions. This module re-exports the engine surface as later slices land.
 */

/** Package version, kept in sync with package.json. */
export const VERSION = '0.1.0';

export * from './domain/schemas.js';
export type * from './domain/types.js';
export * from './cycle/stateMachine.js';
export * from './knowledge/loader.js';
export * from './rules/claimScore.js';
export * from './rules/quantitative.js';
