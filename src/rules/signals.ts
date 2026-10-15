/**
 * Deriving claim-score signals from what a session actually contains.
 *
 * The score (see `claimScore.ts`) is only as honest as its inputs, so every signal
 * here comes from something recorded in the run — the locked hypothesis, the
 * designed experiment, the cited evidence, and the knowledge entries the analyst
 * says the claim supports or conflicts with — never from the model's own opinion
 * of how good the claim is.
 */

import type { ClaimSignals, ScoreWeights } from './claimScore.js';
import { DEFAULT_WEIGHTS, claimScore, nonConsensusScore } from './claimScore.js';
import { evidenceQuality, statisticalSupport, strengthLabel } from '../domain/evidence.js';
import type { EvidenceStrength, ResolvedEvidence } from '../domain/evidence.js';
import type { LockedHypothesis } from '../cycle/session.js';

/** Words that show a test includes a comparison rather than a single measurement. */
export const COMPARISON_PATTERN =
  /\b(?:control|placebo|comparison|compared|versus|vs\.?|randomi[sz]ed|intervention|baseline|before and after|blinded)\b/i;

/** The relation an analyst asserts between the claim and a knowledge entry. */
export type KnowledgeRelation = 'supports' | 'conflicts';

/** A resolved link from the claim to a Bedrock or Established entry. */
export interface ResolvedKnowledgeRef {
  id: string;
  tier: string;
  relation: KnowledgeRelation;
}

/** How well the hypothesis exposes itself to refutation, in [0, 1]. */
export function falsifiabilityQuality(hypothesis: LockedHypothesis, experimentEvidence: readonly string[]): number {
  const observable = hypothesis.falsificationConditions.filter((c) => c.observable);
  if (observable.length === 0) return 0;
  let quality = 0.3;
  if (observable.length >= 2) quality += 0.2;
  if (observable.some((c) => /\d/.test(c.description))) quality += 0.2;
  if (hypothesis.claimType !== undefined) quality += 0.15;
  if (experimentEvidence.some((e) => COMPARISON_PATTERN.test(e))) quality += 0.15;
  return Math.min(1, quality);
}

/** Support from one tier: 1 if the analyst links a supporting entry and none conflict, else 0. */
function tierSupport(refs: readonly ResolvedKnowledgeRef[], tier: string): number {
  const inTier = refs.filter((r) => r.tier === tier);
  if (inTier.some((r) => r.relation === 'conflicts')) return 0;
  return inTier.some((r) => r.relation === 'supports') ? 1 : 0;
}

/** Everything {@link scoreClaim} needs. */
export interface ScoreInput {
  hypothesis: LockedHypothesis;
  experimentEvidence: readonly string[];
  evidence: readonly ResolvedEvidence[];
  knowledgeRefs: readonly ResolvedKnowledgeRef[];
}

/** A claim's score together with the signals behind it. */
export interface ClaimScoreReport {
  score: number;
  /** The score without the consensus term — what actually decides a comparison. */
  nonConsensusScore: number;
  /** What consensus added; never enough to matter on its own. */
  consensusContribution: number;
  signals: ClaimSignals;
  evidenceStrength: EvidenceStrength;
  /** True when the claim conflicts with a Bedrock or Established entry. */
  conflictsWithKnowledge: boolean;
}

/**
 * Score a claim from what the run recorded.
 *
 * `directEvidence` rewards observations and ignores consensus; the consensus
 * signal is the *share* of cited items that were appeals to authority, and it
 * enters at the smallest weight (DESIGN.md §4).
 */
export function scoreClaim(input: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS): ClaimScoreReport {
  const observed = input.evidence.filter((e) => e.kind !== 'consensus');
  const qualities = observed.map(evidenceQuality).sort((a, b) => b - a);
  const best = qualities[0] ?? 0;
  const corroboration = Math.min(0.2, 0.05 * Math.max(0, qualities.filter((q) => q >= 0.4).length - 1));
  const directEvidence = Math.min(1, best + corroboration);

  const consensusItems = input.evidence.filter((e) => e.kind === 'consensus').length;
  const signals: ClaimSignals = {
    bedrockSupport: tierSupport(input.knowledgeRefs, 'bedrock'),
    establishedSupport: tierSupport(input.knowledgeRefs, 'established'),
    directEvidence,
    falsifiabilityQuality: falsifiabilityQuality(input.hypothesis, input.experimentEvidence),
    statisticalSupport: statisticalSupport(input.evidence),
    institutionalConsensus: input.evidence.length === 0 ? 0 : consensusItems / input.evidence.length,
  };

  const total = claimScore(signals, weights);
  const nonConsensus = nonConsensusScore(signals, weights);
  return {
    score: Number(total.toFixed(3)),
    nonConsensusScore: Number(nonConsensus.toFixed(3)),
    consensusContribution: Number((total - nonConsensus).toFixed(3)),
    signals,
    evidenceStrength: strengthLabel(
      directEvidence,
      observed.some((e) => e.replicated === true),
    ),
    conflictsWithKnowledge: input.knowledgeRefs.some((r) => r.relation === 'conflicts'),
  };
}
