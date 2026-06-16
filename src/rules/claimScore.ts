/**
 * The rules engine's scoring core (DESIGN.md §4, "Weighting — where consensus
 * lives").
 *
 * The central commitment of Falsify is encoded here as executable rules:
 *
 *   1. `w_consensus` is the SMALLEST weight in the stack.
 *   2. Consensus can NEVER move a verdict by itself — it is excluded from the
 *      primary comparison between competing claims and is consulted ONLY to break
 *      an otherwise-exact tie.
 *
 * "The ordering is the commitment; the numbers are knobs." The default weights
 * below honor the ordering; they are tunable config.
 */

/** The six weighted signals that make up a claim's score. */
export interface ScoreWeights {
  /** Support from Bedrock-tier laws. */
  bedrock: number;
  /** Support from Established-tier theory. */
  established: number;
  /** Direct experimental evidence. */
  evidence: number;
  /** Falsifiability quality — higher when the claim exposes itself to refutation. */
  falsifiability: number;
  /** Statistical / probabilistic support (the Quantitative lens). */
  math: number;
  /** Institutional consensus. The smallest weight; never decisive on its own. */
  consensus: number;
}

/** Per-claim signal strengths, each expected in the range [0, 1]. */
export interface ClaimSignals {
  bedrockSupport: number;
  establishedSupport: number;
  directEvidence: number;
  falsifiabilityQuality: number;
  statisticalSupport: number;
  institutionalConsensus: number;
}

/**
 * Default weights. Ordering (the commitment) is what matters: consensus is
 * strictly the smallest. Numbers are tunable.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  bedrock: 1.0,
  established: 0.8,
  evidence: 0.7,
  falsifiability: 0.6,
  math: 0.5,
  consensus: 0.1,
};

/** Tolerance within which two non-consensus scores count as a tie. */
const TIE_EPSILON = 1e-9;

/** The non-consensus weight keys — everything except `consensus`. */
const NON_CONSENSUS_KEYS = ['bedrock', 'established', 'evidence', 'falsifiability', 'math'] as const;

/**
 * Assert the weighting commitment: `consensus` must be strictly smaller than
 * every other weight. Call this whenever weights are loaded from config.
 *
 * @throws if `consensus` is not the unique smallest weight.
 */
export function assertWeightOrdering(weights: ScoreWeights): void {
  const minOther = Math.min(...NON_CONSENSUS_KEYS.map((k) => weights[k]));
  if (!(weights.consensus < minOther)) {
    throw new Error(
      `Weighting violation: w_consensus (${weights.consensus}) must be strictly smaller ` +
        `than every other weight (min other = ${minOther}). Consensus is a signal, not a verdict.`,
    );
  }
}

/** The full weighted score, including the small consensus term (DESIGN.md §4). */
export function claimScore(signals: ClaimSignals, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  return (
    weights.bedrock * signals.bedrockSupport +
    weights.established * signals.establishedSupport +
    weights.evidence * signals.directEvidence +
    weights.falsifiability * signals.falsifiabilityQuality +
    weights.math * signals.statisticalSupport +
    weights.consensus * signals.institutionalConsensus
  );
}

/** The score with the consensus term removed — the basis for primary comparison. */
export function nonConsensusScore(
  signals: ClaimSignals,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  return (
    weights.bedrock * signals.bedrockSupport +
    weights.established * signals.establishedSupport +
    weights.evidence * signals.directEvidence +
    weights.falsifiability * signals.falsifiabilityQuality +
    weights.math * signals.statisticalSupport
  );
}

/** How a comparison was decided. */
export type DecidedBy = 'evidence' | 'consensus-tiebreak' | 'tie';

export interface ComparisonResult {
  winner: 'a' | 'b' | 'tie';
  decidedBy: DecidedBy;
  aScore: number;
  bScore: number;
}

/**
 * Compare two competing claims.
 *
 * Consensus is structurally barred from flipping a verdict: the primary
 * comparison uses {@link nonConsensusScore}. Only when the two are tied within
 * {@link TIE_EPSILON} is consensus consulted, and then solely as a tiebreaker.
 */
export function compareClaims(
  a: ClaimSignals,
  b: ClaimSignals,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ComparisonResult {
  assertWeightOrdering(weights);

  const aNon = nonConsensusScore(a, weights);
  const bNon = nonConsensusScore(b, weights);

  if (Math.abs(aNon - bNon) > TIE_EPSILON) {
    return {
      winner: aNon > bNon ? 'a' : 'b',
      decidedBy: 'evidence',
      aScore: aNon,
      bScore: bNon,
    };
  }

  // Exact tie on the evidence — consensus may break it, and only here.
  const aCons = a.institutionalConsensus;
  const bCons = b.institutionalConsensus;
  if (Math.abs(aCons - bCons) <= TIE_EPSILON) {
    return { winner: 'tie', decidedBy: 'tie', aScore: aNon, bScore: bNon };
  }
  return {
    winner: aCons > bCons ? 'a' : 'b',
    decidedBy: 'consensus-tiebreak',
    aScore: aNon,
    bScore: bNon,
  };
}
