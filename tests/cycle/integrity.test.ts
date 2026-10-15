import { describe, it, expect } from 'vitest';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import type { Evidence } from '../../src/domain/evidence.js';
import { CLEAN_YES, MODERATE_EVIDENCE, SEARCH, STRONG_EVIDENCE } from '../helpers/evidence.js';

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

const ok = (r: OpResult): Record<string, unknown> => {
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.rule}: ${r.error}`);
  return r.payload;
};
const rule = (r: OpResult): string => {
  if (r.kind !== 'error') throw new Error('expected error');
  return r.rule;
};

function setup(): { ctx: CycleContext; sessionId: string } {
  const ctx: CycleContext = { sessions: new SessionStore() };
  const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
  ok(
    opHypothesize(
      {
        statement: 'Caffeine lowers reaction time',
        predicts: 'faster responses after the dose',
        falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
        sessionId,
      },
      [],
      ctx,
    ),
  );
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled reaction-time test'], sessionId }, ctx));
  return { ctx, sessionId };
}

describe('analysis integrity in a session', () => {
  it('refuses a yes that says nothing about what was searched', () => {
    const { ctx, sessionId } = setup();
    const r = opAnalyze({ verdict: 'yes', evidence: [MODERATE_EVIDENCE], sessionId }, ctx);
    expect(rule(r)).toBe('analysis:search-disclosure-required');
  });

  it('refuses the forking-paths yes: a p-value from the best of twenty outcomes', () => {
    const { ctx, sessionId } = setup();
    const r = opAnalyze(
      { verdict: 'yes', evidence: [{ ...MODERATE_EVIDENCE, pValue: 0.01, outcomesTested: 20 }], evidenceSearch: SEARCH, sessionId },
      ctx,
    );
    expect(rule(r)).toBe('analysis:not-significant-after-adjustment');
  });

  it('refuses a p-value that does not say how many outcomes it was picked from', () => {
    const { ctx, sessionId } = setup();
    const bare: Evidence = { observation: MODERATE_EVIDENCE.observation, kind: 'experiment', source: 'Trial A', pValue: 0.004 };
    const r = opAnalyze({ verdict: 'yes', evidence: [bare], evidenceSearch: SEARCH, sessionId }, ctx);
    expect(rule(r)).toBe('analysis:outcomes-tested-required');
  });

  it('reports the multiplicity-adjusted p-values on a passing yes', () => {
    const { ctx, sessionId } = setup();
    const p = ok(opAnalyze({ ...CLEAN_YES, sessionId }, ctx));
    expect(JSON.stringify(p)).toContain('adjustedPValues');
  });

  it('caps a replicated result at moderate when contrary results are disclosed', () => {
    const { ctx, sessionId } = setup();
    const p = ok(
      opAnalyze(
        {
          verdict: 'yes',
          evidence: [STRONG_EVIDENCE],
          evidenceSearch: { ...SEARCH, contraryFound: 1, contraryNote: 'One small null trial used a far lower dose than this one.' },
          sessionId,
        },
        ctx,
      ),
    );
    expect((p.claimScore as { evidenceStrength: string }).evidenceStrength).toBe('moderate');
  });
});

describe('review gate on weak evidence', () => {
  it('refuses to confirm weak evidence unless the caller accepts a tentative status', () => {
    const { ctx, sessionId } = setup();
    ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell versus placebo'], evidenceSearch: SEARCH, sessionId }, ctx));

    expect(rule(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx))).toBe('review:evidence-too-weak');

    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', acceptTentative: true, sessionId }, ctx));
    expect(p.epistemicStatus).toBe('tentative');
    expect(p.cycleVerified).toBe(true);
  });

  it('labels replicated evidence supported and unreplicated evidence provisional', () => {
    const strong = setup();
    ok(opAnalyze({ verdict: 'yes', evidence: [STRONG_EVIDENCE], evidenceSearch: SEARCH, sessionId: strong.sessionId }, strong.ctx));
    expect(ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId: strong.sessionId }, strong.ctx)).epistemicStatus).toBe('supported');

    const moderate = setup();
    ok(opAnalyze({ ...CLEAN_YES, sessionId: moderate.sessionId }, moderate.ctx));
    expect(ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId: moderate.sessionId }, moderate.ctx)).epistemicStatus).toBe('provisional');
  });
});
