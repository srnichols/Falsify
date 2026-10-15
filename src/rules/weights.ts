/**
 * Score weights are knobs; their *ordering* is the commitment (DESIGN.md §4).
 *
 * `FALSIFY_WEIGHTS` lets an operator retune the numbers with a JSON object of
 * partial overrides, e.g. `{"evidence":0.9,"consensus":0.05}`. Anything that would
 * let consensus stop being the strictly smallest weight is rejected up front,
 * rather than silently weakening the principle.
 */

import { DEFAULT_WEIGHTS, assertWeightOrdering } from './claimScore.js';
import type { ScoreWeights } from './claimScore.js';

const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[];

/**
 * Build weights from the environment.
 *
 * @throws if the JSON is malformed, names an unknown weight, holds a negative or
 *   non-finite number, or breaks the ordering.
 */
export function loadWeights(env: NodeJS.ProcessEnv = process.env): ScoreWeights {
  const raw = env.FALSIFY_WEIGHTS;
  if (raw === undefined || raw.trim() === '') {
    return { ...DEFAULT_WEIGHTS };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FALSIFY_WEIGHTS must be a JSON object, e.g. {"consensus":0.05}.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('FALSIFY_WEIGHTS must be a JSON object, e.g. {"consensus":0.05}.');
  }

  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!WEIGHT_KEYS.includes(key as keyof ScoreWeights)) {
      throw new Error(`FALSIFY_WEIGHTS names unknown weight '${key}'. Known: ${WEIGHT_KEYS.join(', ')}.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`FALSIFY_WEIGHTS.${key} must be a non-negative number.`);
    }
    weights[key as keyof ScoreWeights] = value;
  }
  assertWeightOrdering(weights);
  return weights;
}
