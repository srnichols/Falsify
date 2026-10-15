/**
 * Calibration harness for the claim score.
 *
 * The score's weights and per-kind credits are heuristics. This measures them
 * against labelled cases instead of trusting them: each case is an evidence
 * profile for a result whose fate is known (held up, or was later refuted), and
 * the harness asks whether the score ranks the profiles that held up above the
 * ones that did not.
 *
 * Be clear about what that proves. The cases are a small, hand-assembled set; a
 * high agreement here is a smoke test and a regression guard, not validation that
 * the score predicts truth. Evidence that *looks* strong yet fails (an unreplicated
 * 6-sigma anomaly) is exactly the hard case, and the harness reports it.
 */

import { z } from 'zod';
import { EvidenceSchema, normalizeEvidence } from '../domain/evidence.js';
import type { ClaimScoreReport } from './signals.js';
import { scoreClaim } from './signals.js';
import { DEFAULT_WEIGHTS } from './claimScore.js';
import type { ScoreWeights } from './claimScore.js';
import type { LockedHypothesis } from '../cycle/session.js';

export const CalibrationCaseSchema = z.object({
  id: z.string().min(1),
  /** What actually happened to the claim. */
  outcome: z.enum(['held-up', 'refuted']),
  /** The result and the evidence offered for it, in a sentence. */
  summary: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
  /** Where the profile comes from, so a reviewer can check it. */
  basis: z.string().min(1),
});

export const CalibrationFileSchema = z.object({
  note: z.string().min(1),
  cases: z.array(CalibrationCaseSchema).min(2),
});

export type CalibrationCase = z.infer<typeof CalibrationCaseSchema>;

/** Every case is scored with the same, reasonably strong hypothesis so only the evidence varies. */
const NEUTRAL_HYPOTHESIS: LockedHypothesis = {
  statement: 'A stated effect exists',
  predicts: 'a measurable change',
  falsificationConditions: [
    { description: 'no change greater than 5 percent in the measured quantity versus control', observable: true },
    { description: 'the effect does not reproduce in an independent run', observable: true },
  ],
  lockedAt: '',
  revision: 0,
};

export interface CalibratedCase {
  id: string;
  outcome: CalibrationCase['outcome'];
  score: number;
  evidenceStrength: ClaimScoreReport['evidenceStrength'];
}

export interface CalibrationResult {
  cases: CalibratedCase[];
  /** Fraction of (held-up, refuted) pairs where the held-up case scored strictly higher. */
  pairwiseAccuracy: number;
  /** The pairs the score got wrong, as "held-up id > refuted id" statements that failed. */
  misordered: string[];
}

/** Score every case and measure how well the score separates what held up from what did not. */
export function evaluateCalibration(
  cases: readonly CalibrationCase[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): CalibrationResult {
  const calibrated: CalibratedCase[] = cases.map((c) => {
    const report = scoreClaim(
      {
        hypothesis: NEUTRAL_HYPOTHESIS,
        experimentEvidence: ['controlled comparison against a baseline'],
        evidence: normalizeEvidence([], c.evidence, () => false),
        knowledgeRefs: [],
      },
      weights,
    );
    return { id: c.id, outcome: c.outcome, score: report.nonConsensusScore, evidenceStrength: report.evidenceStrength };
  });

  const held = calibrated.filter((c) => c.outcome === 'held-up');
  const refuted = calibrated.filter((c) => c.outcome === 'refuted');
  const misordered: string[] = [];
  let correct = 0;
  let pairs = 0;
  for (const h of held) {
    for (const r of refuted) {
      pairs++;
      if (h.score > r.score) correct++;
      else misordered.push(`${h.id} should outscore ${r.id}`);
    }
  }
  return { cases: calibrated, pairwiseAccuracy: pairs === 0 ? 0 : correct / pairs, misordered };
}
