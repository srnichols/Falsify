import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS, compareClaims } from '../../src/rules/claimScore.js';
import { falsifiabilityQuality, scoreClaim } from '../../src/rules/signals.js';
import type { ResolvedEvidence } from '../../src/domain/evidence.js';
import type { LockedHypothesis } from '../../src/cycle/session.js';

const hypothesis = (over: Partial<LockedHypothesis> = {}): LockedHypothesis => ({
  statement: 'Caffeine lowers reaction time',
  predicts: 'faster responses',
  falsificationConditions: [{ description: 'no drop in reaction time versus placebo', observable: true }],
  lockedAt: '2026-10-14T00:00:00.000Z',
  revision: 0,
  ...over,
});

const trial: ResolvedEvidence = {
  observation: 'randomized placebo-controlled trial showed faster responses',
  kind: 'experiment',
  source: 'Trial A',
  sampleSize: 400,
  pValue: 0.004,
  replicated: true,
};

describe('falsifiabilityQuality', () => {
  it('is zero with no observable falsifier and rises with specificity', () => {
    const none = hypothesis({ falsificationConditions: [{ description: 'hidden change', observable: false }] });
    expect(falsifiabilityQuality(none, [])).toBe(0);

    const base = falsifiabilityQuality(hypothesis(), []);
    const rich = falsifiabilityQuality(
      hypothesis({
        claimType: 'causal',
        falsificationConditions: [
          { description: 'no drop in reaction time versus placebo', observable: true },
          { description: 'effect under 5 ms after two weeks', observable: true },
        ],
      }),
      ['blinded placebo-controlled test'],
    );
    expect(rich).toBeGreaterThan(base);
    expect(rich).toBeLessThanOrEqual(1);
  });
});

describe('scoreClaim', () => {
  const base = { hypothesis: hypothesis(), experimentEvidence: ['blinded placebo-controlled test'], knowledgeRefs: [] };

  it('scores sourced, replicated, statistical evidence far above an anecdote', () => {
    const strong = scoreClaim({ ...base, evidence: [trial] });
    const weak = scoreClaim({ ...base, evidence: [{ observation: 'my friend felt faster', kind: 'anecdote' }] });
    expect(strong.evidenceStrength).toBe('strong');
    expect(weak.evidenceStrength).toBe('weak');
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('keeps consensus from rescuing a claim: it adds at most the smallest weight', () => {
    const anecdote: ResolvedEvidence = { observation: 'my friend felt faster', kind: 'anecdote' };
    const onlyConsensus = scoreClaim({
      ...base,
      evidence: [anecdote, { observation: 'experts agree it works', kind: 'consensus' }],
    });
    expect(onlyConsensus.consensusContribution).toBeLessThanOrEqual(DEFAULT_WEIGHTS.consensus);
    expect(onlyConsensus.nonConsensusScore).toBeLessThan(scoreClaim({ ...base, evidence: [trial] }).nonConsensusScore);
  });

  it('a strongly supported claim beats a weak one even when only the weak one has consensus', () => {
    const strong = scoreClaim({ ...base, evidence: [trial] });
    const popular = scoreClaim({
      ...base,
      evidence: [
        { observation: 'my friend felt faster', kind: 'anecdote' },
        { observation: 'experts agree', kind: 'consensus' },
        { observation: 'scientists agree', kind: 'consensus' },
      ],
    });
    const verdict = compareClaims(strong.signals, popular.signals);
    expect(verdict.winner).toBe('a');
    expect(verdict.decidedBy).toBe('evidence');
  });

  it('supporting Bedrock knowledge raises the score; a conflict zeroes that tier and is flagged', () => {
    const evidence = [trial];
    const none = scoreClaim({ ...base, evidence });
    const supports = scoreClaim({ ...base, evidence, knowledgeRefs: [{ id: 'bedrock.x', tier: 'bedrock', relation: 'supports' }] });
    const conflicts = scoreClaim({ ...base, evidence, knowledgeRefs: [{ id: 'bedrock.x', tier: 'bedrock', relation: 'conflicts' }] });
    expect(supports.score).toBeGreaterThan(none.score);
    expect(conflicts.signals.bedrockSupport).toBe(0);
    expect(conflicts.conflictsWithKnowledge).toBe(true);
  });
});
