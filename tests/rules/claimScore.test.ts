import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  assertWeightOrdering,
  claimScore,
  nonConsensusScore,
  compareClaims,
  type ClaimSignals,
  type ScoreWeights,
} from '../../src/rules/claimScore.js';

const ZERO: ClaimSignals = {
  bedrockSupport: 0,
  establishedSupport: 0,
  directEvidence: 0,
  falsifiabilityQuality: 0,
  statisticalSupport: 0,
  institutionalConsensus: 0,
};

describe('weight ordering invariant', () => {
  it('default weights put consensus strictly smallest', () => {
    expect(() => assertWeightOrdering(DEFAULT_WEIGHTS)).not.toThrow();
    const others = [
      DEFAULT_WEIGHTS.bedrock,
      DEFAULT_WEIGHTS.established,
      DEFAULT_WEIGHTS.evidence,
      DEFAULT_WEIGHTS.falsifiability,
      DEFAULT_WEIGHTS.math,
    ];
    expect(DEFAULT_WEIGHTS.consensus).toBeLessThan(Math.min(...others));
  });

  it('rejects weights where consensus ties or exceeds another weight', () => {
    const bad: ScoreWeights = { ...DEFAULT_WEIGHTS, consensus: 0.5, math: 0.5 };
    expect(() => assertWeightOrdering(bad)).toThrow(/w_consensus/);
  });
});

describe('claimScore', () => {
  it('is zero for all-zero signals', () => {
    expect(claimScore(ZERO)).toBe(0);
  });

  it('weights consensus least among unit signals', () => {
    const onlyConsensus = claimScore({ ...ZERO, institutionalConsensus: 1 });
    const onlyEvidence = claimScore({ ...ZERO, directEvidence: 1 });
    const onlyBedrock = claimScore({ ...ZERO, bedrockSupport: 1 });
    expect(onlyConsensus).toBeLessThan(onlyEvidence);
    expect(onlyConsensus).toBeLessThan(onlyBedrock);
  });
});

describe('consensus can only break ties — never flip a verdict', () => {
  it('does not let maxed consensus overturn an evidence advantage', () => {
    // B has the stronger evidence; A has overwhelming consensus.
    const a: ClaimSignals = { ...ZERO, directEvidence: 0.4, institutionalConsensus: 1 };
    const b: ClaimSignals = { ...ZERO, directEvidence: 0.6, institutionalConsensus: 0 };

    const result = compareClaims(a, b);
    expect(result.winner).toBe('b');
    expect(result.decidedBy).toBe('evidence');
  });

  it('breaks an exact evidence tie in favor of higher consensus', () => {
    const a: ClaimSignals = { ...ZERO, directEvidence: 0.5, institutionalConsensus: 0.9 };
    const b: ClaimSignals = { ...ZERO, directEvidence: 0.5, institutionalConsensus: 0.1 };

    const result = compareClaims(a, b);
    expect(result.winner).toBe('a');
    expect(result.decidedBy).toBe('consensus-tiebreak');
  });

  it('reports a true tie when evidence and consensus are equal', () => {
    const a: ClaimSignals = { ...ZERO, directEvidence: 0.5, institutionalConsensus: 0.5 };
    const b: ClaimSignals = { ...ZERO, directEvidence: 0.5, institutionalConsensus: 0.5 };

    const result = compareClaims(a, b);
    expect(result.winner).toBe('tie');
    expect(result.decidedBy).toBe('tie');
  });

  it('primary comparison ignores the consensus term entirely', () => {
    const a: ClaimSignals = { ...ZERO, bedrockSupport: 0.5, institutionalConsensus: 1 };
    expect(nonConsensusScore(a)).toBe(DEFAULT_WEIGHTS.bedrock * 0.5);
  });
});
