import { describe, it, expect } from 'vitest';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { compareSides, summarizeSide } from '../../src/cycle/mirror.js';
import { CLEAN_YES, STRONG_EVIDENCE, SEARCH, verifyReplication } from '../helpers/evidence.js';
import { runMirror } from '../helpers/mirror.js';

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
  ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses after the dose', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled reaction-time test'], sessionId }, ctx));
  return { ctx, sessionId };
}

describe('linking opposite framings', () => {
  it('links both sessions and refuses an unknown or already-paired partner', () => {
    const { ctx, sessionId } = setup();
    const mirror = ok(opIntake({ question: 'Does a 200mg caffeine dose leave reaction time unchanged?', mirrorOf: sessionId }, ctx));
    expect(mirror.mirrorOf).toBe(sessionId);
    expect(ctx.sessions?.get(sessionId)?.mirrorOf).toBe(mirror.sessionId);
    expect(ctx.sessions?.get(mirror.sessionId as string)?.mirrorOf).toBe(sessionId);

    expect(rule(opIntake({ question: 'Does caffeine change reaction time at all?', mirrorOf: 'nope' }, ctx))).toBe('mirror:unknown-session');
    expect(rule(opIntake({ question: 'Does caffeine change reaction time at all?', mirrorOf: sessionId }, ctx))).toBe('mirror:already-paired');
  });

  it('needs a session store', () => {
    expect(rule(opIntake({ question: 'Does a 200mg caffeine dose leave reaction time unchanged?', mirrorOf: 'x' }))).toBe('mirror:session-required');
  });
});

describe('the mirror at review', () => {
  it('holds a replicated result at provisional when no opposite framing was run', async () => {
    const { ctx, sessionId } = setup();
    await verifyReplication(ctx, sessionId);
    ok(opAnalyze({ verdict: 'yes', evidence: [STRONG_EVIDENCE], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.epistemicStatus).toBe('provisional');
    expect(String(p.statusCap)).toMatch(/one-sided/);
    expect((p.mirror as { linked: boolean }).linked).toBe(false);
  });

  it('holds it when the opposite framing was started but never analysed', async () => {
    const { ctx, sessionId } = setup();
    ok(opIntake({ question: 'Does a 200mg caffeine dose leave reaction time unchanged?', mirrorOf: sessionId }, ctx));
    await verifyReplication(ctx, sessionId);
    ok(opAnalyze({ verdict: 'yes', evidence: [STRONG_EVIDENCE], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.epistemicStatus).toBe('provisional');
    expect(String(p.mirrorNote)).toMatch(/not reached analysis/);
  });

  it('allows "supported" once the opposite framing was tested and concluded "no"', async () => {
    const { ctx, sessionId } = setup();
    await verifyReplication(ctx, sessionId);
    runMirror(ctx, sessionId, 'no');
    ok(opAnalyze({ verdict: 'yes', evidence: [STRONG_EVIDENCE], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.epistemicStatus).toBe('supported');
    expect(p.statusCap).toBeUndefined();
    expect((p.mirror as { completed: boolean }).completed).toBe(true);
  });

  it('flags and caps a pair where both opposite framings reached yes', async () => {
    const { ctx, sessionId } = setup();
    await verifyReplication(ctx, sessionId);
    runMirror(ctx, sessionId, 'yes');
    ok(opAnalyze({ verdict: 'yes', evidence: [STRONG_EVIDENCE], evidenceSearch: SEARCH, sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect((p.mirror as { bothFramingsYes?: boolean }).bothFramingsYes).toBe(true);
    expect(p.epistemicStatus).toBe('provisional');
    expect(String(p.mirrorNote)).toMatch(/cannot both be right/);
  });

  it('reports a gap in rigor between the two sides', () => {
    const { ctx, sessionId } = setup();
    runMirror(ctx, sessionId, 'no');
    const thin = ok(opAnalyze({ ...CLEAN_YES, evidence: [CLEAN_YES.evidence[0], { observation: 'second randomized trial showed faster responses', kind: 'experiment', source: 'Trial B', pValue: 0.003, outcomesTested: 1 }, { observation: 'third trial showed faster responses', kind: 'experiment', source: 'Trial C', pValue: 0.002, outcomesTested: 1 }], sessionId }, ctx));
    expect(thin.cycleState).toBe('analysis');
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    const asymmetries = (p.mirror as { asymmetries?: string[] }).asymmetries ?? [];
    expect(asymmetries.join(' ')).toMatch(/Evidence items: 3 here versus 1/);
  });

  it('shows the comparison on a revise too, but only when linked', () => {
    const { ctx, sessionId } = setup();
    ok(opAnalyze({ verdict: 'no', evidenceCited: ['reaction time was unchanged versus placebo'], sessionId }, ctx));
    expect(ok(opReview({ ...ANSWERS, outcome: 'revise', sessionId }, ctx)).mirror).toBeUndefined();
  });
});

describe('compareSides', () => {
  const side = (over: Partial<ReturnType<typeof summarizeSide>> = {}): ReturnType<typeof summarizeSide> => ({
    sessionId: 'a', question: 'q', state: 'review', falsifiers: 2, hypothesesTried: 1, evidenceItems: 2, sourcesVerified: 1, searchWords: 30, contraryFound: 1, ...over,
  });

  it('names nothing when the sides match', () => {
    expect(compareSides(side(), side())).toEqual([]);
  });

  it('names uneven falsifiers, search effort and contrary-result reporting', () => {
    const gaps = compareSides(side(), side({ falsifiers: 1, searchWords: 8, contraryFound: 0 })).join(' ');
    expect(gaps).toMatch(/Falsifiers: this side stated 2/);
    expect(gaps).toMatch(/Search effort/);
    expect(gaps).toMatch(/Contrary results/);
  });
});
