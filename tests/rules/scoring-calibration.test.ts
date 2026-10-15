import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS, compareClaims, assertWeightOrdering } from '../../src/rules/claimScore.js';
import type { ClaimSignals, ScoreWeights } from '../../src/rules/claimScore.js';
import { scoreClaim } from '../../src/rules/signals.js';
import { loadWeights } from '../../src/rules/weights.js';
import type { ResolvedEvidence } from '../../src/domain/evidence.js';
import type { LockedHypothesis } from '../../src/cycle/session.js';

const hypothesis: LockedHypothesis = {
  statement: 'Caffeine lowers reaction time',
  predicts: 'faster responses',
  falsificationConditions: [{ description: 'no drop in reaction time versus placebo', observable: true }],
  lockedAt: '2026-10-14T00:00:00.000Z',
  revision: 0,
};
const base = { hypothesis, experimentEvidence: ['blinded placebo-controlled test'], knowledgeRefs: [] };

const e = (over: Partial<ResolvedEvidence> & { kind: ResolvedEvidence['kind'] }): ResolvedEvidence => ({
  observation: 'reaction time fell versus placebo',
  ...over,
});

/** Evidence profiles ordered from weakest to strongest; the score must rank them this way. */
const LADDER: { name: string; evidence: ResolvedEvidence[] }[] = [
  { name: 'consensus only (plus one anecdote)', evidence: [e({ kind: 'anecdote' }), e({ kind: 'consensus' }), e({ kind: 'consensus' })] },
  { name: 'a single anecdote', evidence: [e({ kind: 'anecdote' })] },
  { name: 'a single unsourced observation', evidence: [e({ kind: 'observation' })] },
  { name: 'a sourced experiment', evidence: [e({ kind: 'experiment', source: 'Trial A' })] },
  { name: 'a sourced, adequately sized experiment', evidence: [e({ kind: 'experiment', source: 'Trial A', sampleSize: 400, pValue: 0.01 })] },
  { name: 'a replicated, large, significant experiment', evidence: [e({ kind: 'experiment', source: 'Trial A', sampleSize: 800, pValue: 0.001, effectSize: 0.4, replicated: true })] },
];

describe('score calibration (golden cases)', () => {
  it('ranks the evidence ladder in order, weakest to strongest', () => {
    const scores = LADDER.map((rung) => scoreClaim({ ...base, evidence: rung.evidence }).nonConsensusScore);
    for (let i = 1; i < scores.length; i++) {
      const message = `${LADDER[i]?.name} should outscore ${LADDER[i - 1]?.name}`;
      if (i === 1) {
        // Piling consensus onto an anecdote must add nothing to the evidence score.
        expect(scores[i], message).toBeGreaterThanOrEqual(scores[i - 1] ?? 0);
      } else {
        expect(scores[i], message).toBeGreaterThan(scores[i - 1] ?? 0);
      }
    }
  });

  it('labels the ends of the ladder weak and strong', () => {
    expect(scoreClaim({ ...base, evidence: LADDER[0]!.evidence }).evidenceStrength).toBe('weak');
    expect(scoreClaim({ ...base, evidence: LADDER[LADDER.length - 1]!.evidence }).evidenceStrength).toBe('strong');
  });

  it('never lets a pile of consensus lift a claim above one sourced observation', () => {
    const pile = Array.from({ length: 25 }, () => e({ kind: 'consensus' }));
    const popular = scoreClaim({ ...base, evidence: [e({ kind: 'anecdote' }), ...pile] });
    const lone = scoreClaim({ ...base, evidence: [e({ kind: 'experiment', source: 'Trial A' })] });
    expect(lone.score).toBeGreaterThan(popular.score);
  });
});

/** A small deterministic PRNG so the property test is reproducible. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('weight ordering is the commitment, whatever the numbers', () => {
  it('consensus cannot flip an evidence-decided comparison under any valid weighting', () => {
    const rand = prng(42);
    const signals = (): ClaimSignals => ({
      bedrockSupport: Math.round(rand()),
      establishedSupport: Math.round(rand()),
      directEvidence: rand(),
      falsifiabilityQuality: rand(),
      statisticalSupport: rand(),
      institutionalConsensus: rand(),
    });

    for (let n = 0; n < 500; n++) {
      const floor = 0.1 + rand();
      const weights: ScoreWeights = {
        bedrock: floor + rand(),
        established: floor + rand(),
        evidence: floor + rand(),
        falsifiability: floor + rand(),
        math: floor + rand(),
        consensus: floor * rand() * 0.99,
      };
      assertWeightOrdering(weights);

      const a = signals();
      const b = signals();
      const verdict = compareClaims(a, b, weights);
      // Swap which claim has the consensus: an evidence-decided verdict must not change.
      const swapped = compareClaims(
        { ...a, institutionalConsensus: b.institutionalConsensus },
        { ...b, institutionalConsensus: a.institutionalConsensus },
        weights,
      );
      expect(swapped.winner).toBe(verdict.winner);
      if (verdict.decidedBy === 'evidence') expect(swapped.decidedBy).toBe('evidence');
    }
  });
});

describe('loadWeights', () => {
  it('returns the defaults with no override and applies partial overrides', () => {
    expect(loadWeights({})).toEqual(DEFAULT_WEIGHTS);
    expect(loadWeights({ FALSIFY_WEIGHTS: '{"evidence":0.9,"consensus":0.05}' })).toEqual({
      ...DEFAULT_WEIGHTS,
      evidence: 0.9,
      consensus: 0.05,
    });
  });

  it.each([
    ['not json', 'must be a JSON object'],
    ['[1,2]', 'must be a JSON object'],
    ['{"vibes":1}', "unknown weight 'vibes'"],
    ['{"evidence":-1}', 'non-negative'],
    ['{"evidence":"high"}', 'non-negative'],
    ['{"consensus":0.9}', 'strictly smaller'],
    ['{"math":0.05}', 'strictly smaller'],
  ])('rejects %s', (raw, message) => {
    expect(() => loadWeights({ FALSIFY_WEIGHTS: raw })).toThrow(message);
  });
});
