/**
 * The Quantitative tier as a cross-cutting validator (DESIGN.md §4).
 *
 * Quantitative principles are NOT a shelf of facts and carry NO tier weight in
 * the claim score. They are a lens: every claim is run through base-rate /
 * probability checks before it is reported. This module flags which principles a
 * claim's text triggers, so the engine can surface the guarded failure modes.
 */

import type { QuantEntry } from '../domain/types.js';

/** A triggered quantitative principle and the failure it guards against. */
export interface QuantFlag {
  id: string;
  principle: string;
  failureGuarded: string;
  matchedTriggers: string[];
}

/**
 * Apply the quantitative lens to a piece of claim text.
 *
 * @param text the claim / evidence wording to screen.
 * @param principles the loaded Quantitative-tier entries.
 * @returns one flag per principle whose triggers appear in the text.
 */
export function applyQuantitativeLens(text: string, principles: QuantEntry[]): QuantFlag[] {
  const haystack = text.toLowerCase();
  const flags: QuantFlag[] = [];

  for (const principle of principles) {
    const matched = principle.triggers.filter((t) => haystack.includes(t.toLowerCase()));
    if (matched.length > 0) {
      flags.push({
        id: principle.id,
        principle: principle.principle,
        failureGuarded: principle.failure_guarded,
        matchedTriggers: matched,
      });
    }
  }

  return flags;
}
