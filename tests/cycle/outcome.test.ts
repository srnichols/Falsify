import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import { opOutcome } from '../../src/cycle/outcome.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { NotebookStore } from '../../src/memory/notebook.js';
import { OutcomeStore } from '../../src/memory/outcomes.js';
import type { OutcomeRecord } from '../../src/memory/outcomes.js';
import { evaluateOutcomes, MIN_PER_CLASS } from '../../src/rules/outcomeCalibration.js';
import { CLEAN_YES } from '../helpers/evidence.js';

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};
const BASIS = 'An independent lab replicated the trial with the same protocol';

const ok = (r: OpResult): Record<string, unknown> => {
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.rule}: ${r.error}`);
  return r.payload;
};
const rule = (r: OpResult): string => {
  if (r.kind !== 'error') throw new Error('expected error');
  return r.rule;
};

describe('opOutcome', () => {
  let dir: string;
  let ctx: CycleContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-outcome-'));
    ctx = { sessions: new SessionStore(), notebook: new NotebookStore(join(dir, 'nb')), outcomes: new OutcomeStore(join(dir, 'out')) };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function confirmed(): string {
    const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
    ok(opAnalyze({ ...CLEAN_YES, sessionId }, ctx));
    ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    return sessionId;
  }

  it('records an outcome with the score the theory was confirmed with', () => {
    const sessionId = confirmed();
    const p = ok(opOutcome({ sessionId, outcome: 'held-up', basis: BASIS, reference: '10.1000/xyz' }, ctx));
    expect(p.recorded).toBe(true);
    const [rec] = ctx.outcomes!.current();
    expect(rec?.snapshot.evidenceStrength).toBe('moderate');
    expect(rec?.snapshot.nonConsensusScore).toBeGreaterThan(0);
    expect(ctx.notebook?.list().some((i) => i.kind === 'outcome')).toBe(true);
  });

  it('refuses an outcome for an inquiry that is not a confirmed theory', () => {
    const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    expect(rule(opOutcome({ sessionId, outcome: 'held-up', basis: BASIS }, ctx))).toBe('outcome:no-theory');
    expect(rule(opOutcome({ sessionId: 'nope', outcome: 'held-up', basis: BASIS }, ctx))).toBe('session:unknown');
  });

  it('refuses an outcome that does not say what happened', () => {
    const sessionId = confirmed();
    expect(rule(opOutcome({ sessionId, outcome: 'refuted', basis: 'it failed' }, ctx))).toBe('outcome:basis-required');
  });

  it('keeps the earlier outcome when a later one supersedes it', () => {
    const sessionId = confirmed();
    ok(opOutcome({ sessionId, outcome: 'held-up', basis: BASIS }, ctx));
    ok(opOutcome({ sessionId, outcome: 'refuted', basis: 'A larger preregistered trial found no effect at all' }, ctx));
    expect(ctx.outcomes!.history()).toHaveLength(2);
    expect(ctx.outcomes!.current().map((r) => r.outcome)).toEqual(['refuted']);
  });
});

describe('evaluateOutcomes', () => {
  const rec = (i: number, outcome: OutcomeRecord['outcome'], score: number, strength: 'weak' | 'moderate' | 'strong'): OutcomeRecord => ({
    sessionId: `s${i}`,
    outcome,
    basis: 'later evidence settled it',
    recordedAt: '2026-01-01T00:00:00Z',
    snapshot: { statement: 's', nonConsensusScore: score, evidenceStrength: strength, hypothesesTried: 1 },
  });

  it('says nothing until there are enough of each outcome', () => {
    const r = evaluateOutcomes([rec(1, 'held-up', 1, 'strong'), rec(2, 'refuted', 0.5, 'weak')]);
    expect(r.sufficient).toBe(false);
    expect(r.pairwiseAccuracy).toBeUndefined();
    expect(r.message).toMatch(/Not enough/);
  });

  it('reports pairwise accuracy and the strength breakdown once there is enough', () => {
    const held = Array.from({ length: MIN_PER_CLASS }, (_, i) => rec(i, 'held-up', 1.2, 'strong'));
    const refuted = Array.from({ length: MIN_PER_CLASS }, (_, i) => rec(100 + i, 'refuted', 0.6, 'weak'));
    const r = evaluateOutcomes([...held, ...refuted, rec(999, 'inconclusive', 1, 'moderate')]);
    expect(r.sufficient).toBe(true);
    expect(r.pairwiseAccuracy).toBe(1);
    expect(r.inconclusive).toBe(1);
    expect(r.byStrength.find((s) => s.strength === 'strong')).toEqual({ strength: 'strong', heldUp: MIN_PER_CLASS, refuted: 0 });
  });
});
