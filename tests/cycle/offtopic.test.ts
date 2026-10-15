import { describe, it, expect } from 'vitest';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import { opVerifySource } from '../../src/cycle/verify.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { SEARCH } from '../helpers/evidence.js';

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};
const ok = (r: OpResult): Record<string, unknown> => {
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.rule}: ${r.error}`);
  return r.payload;
};

const OFF_TOPIC = '10.1038/35070613';
const ON_TOPIC = '10.1000/caffeine.1';
const TITLES: Record<string, string> = {
  [OFF_TOPIC]: 'Functional proteins from a random-sequence library',
  [ON_TOPIC]: 'Caffeine and reaction time: a randomized trial',
};

async function start(): Promise<{ ctx: CycleContext; sessionId: string }> {
  const ctx: CycleContext = {
    sessions: new SessionStore(),
    verifySource: async (doi) => ({ verified: true, doi, title: TITLES[doi] ?? 'x', venue: 'V', year: 2001, authors: [] }),
  };
  const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
  ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
  await opVerifySource({ doi: OFF_TOPIC, sessionId }, ctx);
  await opVerifySource({ doi: ON_TOPIC, sessionId }, ctx);
  return { ctx, sessionId };
}

const trial = (doi: string, source: string) => ({
  observation: 'randomized placebo-controlled trial showed faster responses after caffeine',
  kind: 'experiment' as const,
  source,
  doi,
  pValue: 0.004,
  outcomesTested: 1,
});

describe('a yes that rests only on off-topic sources', () => {
  it('is held at tentative and says why', async () => {
    const { ctx, sessionId } = await start();
    ok(opAnalyze({ verdict: 'yes', evidence: [trial(OFF_TOPIC, 'Keefe & Szostak 2001')], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', acceptTentative: true, sessionId }, ctx));
    expect(p.epistemicStatus).toBe('tentative');
    expect(String(p.statusCap)).toMatch(/nothing to do with the claim/);
  });

  it('is not capped when a relevant, verified source supports it too', async () => {
    const { ctx, sessionId } = await start();
    ok(opAnalyze({ verdict: 'yes', evidence: [trial(OFF_TOPIC, 'Keefe & Szostak 2001'), trial(ON_TOPIC, 'Trial A')], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.epistemicStatus).toBe('provisional');
    expect(p.statusCap).toBeUndefined();
  });

  it('does not touch evidence that cites no DOI at all', async () => {
    const { ctx, sessionId } = await start();
    ok(opAnalyze({ verdict: 'yes', evidence: [{ observation: 'randomized placebo-controlled trial showed faster responses', kind: 'experiment', source: 'Trial A', pValue: 0.004, outcomesTested: 1 }], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.epistemicStatus).toBe('provisional');
  });
});
