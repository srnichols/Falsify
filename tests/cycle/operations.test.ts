import { describe, it, expect } from 'vitest';
import {
  opIntake,
  opHypothesize,
  opExperiment,
  opAnalyze,
  opReview,
  opRecall,
  CONSENSUS_CHALLENGE,
} from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { QuantEntry } from '../../src/domain/types.js';
import type { MemoryReader, RecallQuery } from '../../src/memory/openbrainClient.js';

const TEST_PRINCIPLES: QuantEntry[] = [
  {
    id: 'q-base-rate',
    tier: 'quantitative',
    claim: 'Always ask the base rate.',
    triggers: ['cause', 'causes'],
    weight: 1,
  } as unknown as QuantEntry,
];

function okPayload(result: OpResult): Record<string, unknown> {
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('expected ok');
  return result.payload;
}

describe('opIntake', () => {
  it('advances a falsifiable question to hypothesis', () => {
    const p = okPayload(opIntake({ question: 'Does aspirin reduce fever within 1 hour?' }));
    expect(p.falsifiable).toBe(true);
    expect(p.cycleState).toBe('hypothesis');
  });

  it('flags a normative claim and stays put', () => {
    const p = okPayload(opIntake({ question: 'Nuclear power should be banned.' }));
    expect(p.falsifiable).toBe(false);
    expect(p.cycleState).toBeUndefined();
    expect(p.reframedHint).toBeTruthy();
  });

  it('answers a consensus appeal with the challenge', () => {
    const p = okPayload(opIntake({ question: 'The science is settled on this.' }));
    expect(p.consensusAppeal).toBe(true);
    expect(p.challenge).toBe(CONSENSUS_CHALLENGE);
  });
});

describe('opHypothesize', () => {
  it('rejects a hypothesis with no falsification condition', () => {
    const r = opHypothesize(
      { statement: 'X causes Y', predicts: 'more X, more Y', falsificationConditions: [] },
      TEST_PRINCIPLES,
    );
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.rule).toBe('honesty:falsification-condition-required');
    }
  });

  it('accepts a falsifiable hypothesis and applies the quant lens', () => {
    const p = okPayload(
      opHypothesize(
        {
          statement: 'Caffeine causes faster reaction time',
          predicts: 'lower ms after caffeine',
          falsificationConditions: [{ description: 'no change in reaction time after caffeine' }],
        },
        TEST_PRINCIPLES,
      ),
    );
    expect(p.cycleState).toBe('experiment');
    expect(Array.isArray(p.quantFlags)).toBe(true);
  });
});

describe('opExperiment', () => {
  it('rejects an experiment that cannot fail', () => {
    const r = opExperiment({ couldFail: false, decisiveEvidence: ['x'] });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.rule).toBe('honesty:experiment-must-be-able-to-fail');
    }
  });

  it('rejects an experiment with no decisive evidence', () => {
    const r = opExperiment({ couldFail: true, decisiveEvidence: [] });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.rule).toBe('honesty:experiment-needs-decisive-evidence');
    }
  });

  it('advances a falsifiable experiment to analysis', () => {
    const p = okPayload(opExperiment({ couldFail: true, decisiveEvidence: ['measure reaction time'] }));
    expect(p.cycleState).toBe('analysis');
  });
});

describe('opAnalyze', () => {
  it('requires cited evidence', () => {
    const r = opAnalyze({ verdict: 'no', evidenceCited: [] });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.rule).toBe('analysis:evidence-required');
  });

  it('routes a "no" verdict to review', () => {
    const p = okPayload(opAnalyze({ verdict: 'no', evidenceCited: ['data disagreed'] }));
    expect(p.cycleState).toBe('review');
  });

  it('does NOT finalize a "yes": flags reviewRequired and stays in analysis', () => {
    const p = okPayload(opAnalyze({ verdict: 'yes', evidenceCited: ['data agreed'] }));
    expect(p.reviewRequired).toBe(true);
    expect(p.cycleState).toBe('analysis');
  });
});

describe('opReview', () => {
  it('requires all three answers', () => {
    const r = opReview({ q1Methods: 'ok', q2Hypothesis: '', q3Theory: 'ok', outcome: 'revise' });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.rule).toBe('review:three-questions-required');
  });

  it('revise loops back to hypothesis', () => {
    const p = okPayload(
      opReview({ q1Methods: 'sound', q2Hypothesis: 'too broad', q3Theory: 'intact', outcome: 'revise' }),
    );
    expect(p.cycleState).toBe('hypothesis');
  });

  it('confirm finalizes a theory', () => {
    const p = okPayload(
      opReview({ q1Methods: 'sound', q2Hypothesis: 'held', q3Theory: 'intact', outcome: 'confirm' }),
    );
    expect(p.cycleState).toBe('theory');
  });
});

describe('opRecall', () => {
  it('returns results from an injected reader', async () => {
    const reader: MemoryReader = {
      recall: async (_q: RecallQuery) => [{ id: 1, text: 'a prior thought' }],
    };
    const p = okPayload(await opRecall({ query: 'falsification' }, reader));
    expect(p.count).toBe(1);
    expect(p.query).toBe('falsification');
  });

  it('degrades to a structured error when the reader throws, never leaking the key', async () => {
    const reader: MemoryReader = {
      recall: async () => {
        throw new Error('connect ECONNREFUSED key=SECRET_KEY_ABC123');
      },
    };
    const r = await opRecall({ query: 'x' }, reader);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.rule).toBe('recall:brain-unreachable');
      const text = JSON.stringify(r);
      expect(text).not.toContain('SECRET_KEY_ABC123');
    }
  });
});
