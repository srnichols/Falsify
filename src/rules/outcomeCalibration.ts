/**
 * Check the claim score against what actually happened to the theories Falsify
 * recorded. This is the data that matches what the score is used for, and it is
 * the only honest route to grounding the weights: until enough outcomes exist the
 * report says so instead of printing a number that looks like validation.
 */

import type { OutcomeRecord } from '../memory/outcomes.js';

/** Fewest labelled outcomes of each kind before a pairwise accuracy is reported. */
export const MIN_PER_CLASS = 5;

export interface OutcomeReport {
  total: number;
  heldUp: number;
  refuted: number;
  inconclusive: number;
  /** Held-up rate by the evidence strength the theory was confirmed with. */
  byStrength: { strength: string; heldUp: number; refuted: number }[];
  /** Fraction of (held-up, refuted) pairs the score ordered correctly; undefined until there is enough data. */
  pairwiseAccuracy?: number;
  sufficient: boolean;
  message: string;
}

export function evaluateOutcomes(records: readonly OutcomeRecord[]): OutcomeReport {
  const held = records.filter((r) => r.outcome === 'held-up');
  const refuted = records.filter((r) => r.outcome === 'refuted');
  const inconclusive = records.filter((r) => r.outcome === 'inconclusive').length;

  const strengths = ['weak', 'moderate', 'strong'];
  const byStrength = strengths.map((strength) => ({
    strength,
    heldUp: held.filter((r) => r.snapshot.evidenceStrength === strength).length,
    refuted: refuted.filter((r) => r.snapshot.evidenceStrength === strength).length,
  }));

  const sufficient = held.length >= MIN_PER_CLASS && refuted.length >= MIN_PER_CLASS;
  const scored = (rs: readonly OutcomeRecord[]): number[] =>
    rs.map((r) => r.snapshot.nonConsensusScore).filter((s): s is number => s !== undefined);
  const heldScores = scored(held);
  const refutedScores = scored(refuted);

  let pairwiseAccuracy: number | undefined;
  if (sufficient && heldScores.length > 0 && refutedScores.length > 0) {
    let wins = 0;
    let pairs = 0;
    for (const h of heldScores) {
      for (const r of refutedScores) {
        pairs++;
        if (h > r) wins += 1;
        else if (h === r) wins += 0.5;
      }
    }
    pairwiseAccuracy = wins / pairs;
  }

  const message = sufficient
    ? 'Enough labelled outcomes to compare, but these are self-reported and from your own inquiries: treat the result as a check on the score, not a calibration of it, until the set is large and independently labelled.'
    : `Not enough outcomes to say anything: need at least ${MIN_PER_CLASS} held-up and ${MIN_PER_CLASS} refuted (have ${held.length} and ${refuted.length}). Record outcomes with falsify_outcome as results come in.`;

  return {
    total: records.length,
    heldUp: held.length,
    refuted: refuted.length,
    inconclusive,
    byStrength,
    ...(pairwiseAccuracy !== undefined ? { pairwiseAccuracy } : {}),
    sufficient,
    message,
  };
}
