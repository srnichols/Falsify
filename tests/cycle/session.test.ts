import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  opIntake,
  opHypothesize,
  opExperiment,
  opAnalyze,
  opReview,
} from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { NotebookStore } from '../../src/memory/notebook.js';
import type { BrainMemory, MemoryWriter, SaveResult } from '../../src/memory/openbrainClient.js';

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

function ok(result: OpResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.rule}: ${result.error}`);
  return result.payload;
}

function rule(result: OpResult): string {
  if (result.kind !== 'error') throw new Error('expected error');
  return result.rule;
}

describe('cycle sessions', () => {
  let dir: string;
  let ctx: CycleContext;
  let saved: BrainMemory[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-session-'));
    saved = [];
    const corpus: MemoryWriter = {
      save: vi.fn(async (m: BrainMemory): Promise<SaveResult> => {
        saved.push(m);
        return { saved: true, queued: false, drained: 0 };
      }),
    };
    ctx = { sessions: new SessionStore(), notebook: new NotebookStore(join(dir, 'nb')), corpus };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const hypothesis = {
    statement: 'A 200mg caffeine dose lowers reaction time',
    predicts: 'reaction time falls after caffeine',
    falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
  };

  function start(): string {
    const intake = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx));
    return intake.sessionId as string;
  }

  function throughExperiment(sessionId: string, extra: Record<string, unknown> = {}): void {
    ok(opHypothesize({ ...hypothesis, ...extra, sessionId }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled reaction-time test'], sessionId }, ctx));
  }

  it('issues a session at intake and tracks state server-side', () => {
    const sessionId = start();
    expect(ctx.sessions?.get(sessionId)?.state).toBe('hypothesis');
    const p = ok(opHypothesize({ ...hypothesis, sessionId }, [], ctx));
    expect(p.cycleState).toBe('experiment');
    expect(ctx.sessions?.get(sessionId)?.state).toBe('experiment');
  });

  it('does not create a session for a non-falsifiable question', () => {
    const p = ok(opIntake({ question: 'Nuclear power should be banned.' }, ctx));
    expect(p.sessionId).toBeUndefined();
  });

  it('rejects an unknown session and a conflicting cycleState', () => {
    expect(rule(opHypothesize({ ...hypothesis, sessionId: 'nope' }, [], ctx))).toBe('session:unknown');
    const sessionId = start();
    expect(rule(opHypothesize({ ...hypothesis, sessionId, cycleState: 'analysis' }, [], ctx))).toBe(
      'session:state-mismatch',
    );
  });

  it('refuses to skip ahead: analyze before an experiment is illegal', () => {
    const sessionId = start();
    expect(rule(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell'], sessionId }, ctx))).toBe(
      'cycle:illegal-transition',
    );
  });

  it('refuses to confirm a theory that never had a yes verdict', () => {
    const sessionId = start();
    throughExperiment(sessionId);
    const r = opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx);
    expect(rule(r)).toBe('review:yes-verdict-required');
  });

  it('locks the prediction before analysis and reports when', () => {
    const sessionId = start();
    throughExperiment(sessionId);
    const lockedAt = ctx.sessions?.get(sessionId)?.hypothesis?.lockedAt;
    const p = ok(opAnalyze({ verdict: 'no', evidenceCited: ['reaction time was unchanged'], sessionId }, ctx));
    expect(p.predictionLockedAt).toBe(lockedAt);
  });

  it('strikes a refuted hypothesis through in the notebook and demands an honest revision', () => {
    const sessionId = start();
    throughExperiment(sessionId);
    ok(opAnalyze({ verdict: 'no', evidenceCited: ['reaction time was unchanged'], sessionId }, ctx));
    const rev = ok(opReview({ ...ANSWERS, outcome: 'revise', sessionId }, ctx));
    expect(rev.cycleState).toBe('hypothesis');

    const items = ctx.notebook?.list() ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('hypothesis');
    expect(items[0]?.struck?.reason).toContain('reaction time was unchanged');

    // No explanation of what changed.
    expect(rule(opHypothesize({ ...hypothesis, sessionId }, [], ctx))).toBe('honesty:revision-note-required');

    const twoConditions = {
      ...hypothesis,
      falsificationConditions: [
        { description: 'no drop in reaction time versus placebo' },
        { description: 'effect disappears at the higher dose' },
      ],
      revisionNote: 'Raised the dose after the null result at 200mg.',
      sessionId,
    };
    ok(opHypothesize(twoConditions, [], ctx));
    expect(ctx.sessions?.get(sessionId)?.refuted).toHaveLength(1);
  });

  it('rejects a revision that drops a falsification condition', () => {
    const sessionId = start();
    ok(
      opHypothesize(
        {
          ...hypothesis,
          falsificationConditions: [
            { description: 'no drop in reaction time versus placebo' },
            { description: 'effect disappears at the higher dose' },
          ],
          sessionId,
        },
        [],
        ctx,
      ),
    );
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
    ok(opAnalyze({ verdict: 'no', evidenceCited: ['reaction time was unchanged'], sessionId }, ctx));
    ok(opReview({ ...ANSWERS, outcome: 'revise', sessionId }, ctx));
    const r = opHypothesize(
      { ...hypothesis, revisionNote: 'Narrowed the claim after the null result.', sessionId },
      [],
      ctx,
    );
    expect(rule(r)).toBe('honesty:revision-weakens-falsifiability');
  });

  it('records a verified theory in the notebook and the corpus after a real yes', () => {
    const sessionId = start();
    throughExperiment(sessionId);
    ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell versus placebo'], sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));

    expect(p.cycleState).toBe('theory');
    expect(p.verified).toBe(true);
    expect(ctx.notebook?.list().map((i) => i.kind)).toEqual(['theory']);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.source).toBe('falsify-cycle');
    expect(saved[0]?.metadata?.tier).toBe('survived-test');
    expect(String(saved[0]?.metadata?.falsified_if)).toContain('no drop in reaction time');
  });

  it('does not let a corpus failure block the cycle', async () => {
    ctx.corpus = { save: async () => Promise.reject(new Error('brain offline')) };
    const sessionId = start();
    throughExperiment(sessionId);
    ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell versus placebo'], sessionId }, ctx));
    const p = ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(p.cycleState).toBe('theory');
    await Promise.resolve();
  });

  it('survives a restart when given a directory', () => {
    const persistent = new SessionStore(join(dir, 'sessions'));
    const id = persistent.create('Does X lower Y?').id;
    const reloaded = new SessionStore(join(dir, 'sessions'));
    expect(reloaded.get(id)?.question).toBe('Does X lower Y?');
    expect(reloaded.get('../../etc/passwd')).toBeUndefined();
  });
});

describe('claim types', () => {
  it('requires a numeric threshold for a probabilistic claim', () => {
    const r = opHypothesize(
      {
        statement: 'Coin lands heads more often than tails',
        predicts: 'more heads in many flips',
        claimType: 'probabilistic',
        falsificationConditions: [{ description: 'heads and tails appear equally often' }],
      },
      [],
    );
    expect(rule(r)).toBe('honesty:statistical-threshold-required');
  });

  it('requires a comparison for a causal claim inside a session', () => {
    const sessions = new SessionStore();
    const ctx: CycleContext = { sessions };
    const intake = ok(opIntake({ question: 'Does caffeine lower reaction time?' }, ctx));
    const sessionId = intake.sessionId as string;
    ok(
      opHypothesize(
        {
          statement: 'Caffeine lowers reaction time',
          predicts: 'faster responses',
          claimType: 'causal',
          falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
          sessionId,
        },
        [],
        ctx,
      ),
    );
    const r = opExperiment({ couldFail: true, decisiveEvidence: ['measure reaction time once'], sessionId }, ctx);
    expect(rule(r)).toBe('honesty:causal-claim-needs-comparison');
  });
});

describe('consensus is not evidence', () => {
  it('refuses an analysis that cites only appeals to authority', () => {
    const r = opAnalyze({ verdict: 'yes', evidenceCited: ['scientists agree on this', 'the science is settled'] });
    expect(rule(r)).toBe('analysis:consensus-is-not-evidence');
  });

  it('answers a mixed analysis with the challenge', () => {
    const p = ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell versus placebo', 'experts agree'] }));
    expect(p.consensusCitedAsEvidence).toEqual(['experts agree']);
    expect(p.challenge).toBeTruthy();
  });
});

describe('hypothesis substance and knowledge matching', () => {
  it('rejects a vacuous falsification condition', () => {
    const r = opHypothesize(
      { statement: 'X causes Y', predicts: 'Y follows X', falsificationConditions: [{ description: "if it's wrong" }] },
      [],
    );
    expect(rule(r)).toBe('honesty:falsification-condition-vacuous');
  });

  it('rejects conditions that are all unobservable', () => {
    const r = opHypothesize(
      {
        statement: 'X causes Y',
        predicts: 'Y follows X',
        falsificationConditions: [{ description: 'a hidden change nobody can detect', observable: false }],
      },
      [],
    );
    expect(rule(r)).toBe('honesty:falsification-condition-unobservable');
  });

  it('surfaces a refuted lookalike and the Bedrock law a claim touches', () => {
    const refuted = ok(
      opHypothesize(
        {
          statement: 'Stomach ulcers are caused by stress and spicy food',
          predicts: 'reducing stress heals ulcers',
          falsificationConditions: [{ description: 'ulcers heal after antibiotics alone' }],
        },
        [],
      ),
    );
    const matches = refuted.knowledgeMatches as { tier: string; id: string }[];
    expect(matches.some((m) => m.tier === 'refuted' && m.id === 'refuted.medicine.ulcer_stress_only')).toBe(true);

    const bedrock = ok(
      opHypothesize(
        {
          statement: 'Energy can be created from nothing in a closed system',
          predicts: 'output energy exceeds input energy',
          falsificationConditions: [{ description: 'a calorimeter shows output equal to input' }],
        },
        [],
      ),
    );
    const bedrockMatches = bedrock.knowledgeMatches as { tier: string; directive: string }[];
    expect(bedrockMatches.some((m) => m.tier === 'bedrock')).toBe(true);
  });
});

describe('intake classifier', () => {
  it.each([
    'The bridge must carry 10 tonnes without deflecting more than 2 cm.',
    'Copper is a good conductor of heat.',
    'Is drug A better than drug B at reducing fever?',
    'What should I expect to observe if the moon is closer than the sun?',
  ])('does not mistake an empirical question for a value claim: %s', (question) => {
    expect(ok(opIntake({ question })).falsifiable).toBe(true);
  });

  it.each([
    'Nuclear power should be banned.',
    'Society should ban all single-use plastics.',
    'Is it morally wrong to eat meat?',
    'Should I take vitamin D?',
  ])('still flags a value claim: %s', (question) => {
    expect(ok(opIntake({ question })).falsifiable).toBe(false);
  });
});
