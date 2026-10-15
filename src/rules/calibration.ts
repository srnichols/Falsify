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

export interface WeightSensitivity {
  /** How many random weightings were tried. */
  samples: number;
  /** Pairwise accuracy under the shipped weights. */
  baseline: number;
  min: number;
  median: number;
  max: number;
  /** Share of random weightings that did at least as well as the shipped ones. */
  shareAtLeastBaseline: number;
  /** Accuracy as the weight on statistical support is varied against direct evidence. */
  ratioSweep: { mathPerEvidence: number; accuracy: number }[];
}

/** A small, seedable generator so a sensitivity run can be repeated exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How much the calibration result depends on the hand-set weights. Draws random
 * weightings (each weight uniform in [0.1, 1.5], consensus kept strictly smallest, as
 * the engine requires) and sweeps the statistical-to-evidence ratio. If accuracy is
 * high across most of the space, the ordering of the cases does not hinge on the exact
 * numbers; if it collapses, the numbers are doing more work than they have earned.
 * Only the signals the cases vary (evidence and statistics) can move the result: the
 * cases hold the hypothesis and knowledge links fixed, so the other weights are untested here.
 */
export function weightSensitivity(
  cases: readonly CalibrationCase[],
  options: { samples?: number; seed?: number } = {},
): WeightSensitivity {
  const samples = options.samples ?? 500;
  const random = mulberry32(options.seed ?? 1);
  const baseline = evaluateCalibration(cases, DEFAULT_WEIGHTS).pairwiseAccuracy;
  const draw = (): number => 0.1 + 1.4 * random();

  const accuracies: number[] = [];
  for (let i = 0; i < samples; i++) {
    const weights: ScoreWeights = {
      bedrock: draw(),
      established: draw(),
      evidence: draw(),
      falsifiability: draw(),
      math: draw(),
      consensus: 0,
    };
    weights.consensus = Math.min(weights.bedrock, weights.established, weights.evidence, weights.falsifiability, weights.math) * 0.5;
    accuracies.push(evaluateCalibration(cases, weights).pairwiseAccuracy);
  }
  accuracies.sort((a, b) => a - b);

  const ratios = [0.25, 0.5, 1, 2, 4, 8];
  const ratioSweep = ratios.map((mathPerEvidence) => ({
    mathPerEvidence,
    accuracy: evaluateCalibration(cases, { ...DEFAULT_WEIGHTS, evidence: 0.7, math: 0.7 * mathPerEvidence, consensus: 0.01 }).pairwiseAccuracy,
  }));

  return {
    samples,
    baseline,
    min: accuracies[0] ?? 0,
    median: accuracies[Math.floor(accuracies.length / 2)] ?? 0,
    max: accuracies[accuracies.length - 1] ?? 0,
    shareAtLeastBaseline: accuracies.filter((a) => a >= baseline - 1e-9).length / samples,
    ratioSweep,
  };
}
