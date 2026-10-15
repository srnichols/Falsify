import { describe, it, expect, vi } from 'vitest';
import { checkDoi } from '../../src/rules/sourceCheck.js';
import type { SourceCheck, SourceFetch } from '../../src/rules/sourceCheck.js';
import { normalizeDoi, evidenceQuality } from '../../src/domain/evidence.js';
import type { ResolvedEvidence } from '../../src/domain/evidence.js';
import { opIntake, opHypothesize, opExperiment, opAnalyze } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import { opVerifySource } from '../../src/cycle/verify.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { SEARCH } from '../helpers/evidence.js';

const CROSSREF_OK = {
  message: {
    title: ['Observation of Gravitational Waves from a Binary Black Hole Merger'],
    'container-title': ['Physical Review Letters'],
    issued: { 'date-parts': [[2016, 2, 11]] },
    author: [{ family: 'Abbott' }, { family: 'Abbott' }],
  },
};
const json = (status: number, body: unknown): ReturnType<SourceFetch> =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

function ok(result: OpResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.rule}: ${result.error}`);
  return result.payload;
}

describe('normalizeDoi', () => {
  it.each([
    ['10.1103/PhysRevLett.116.061102', '10.1103/physrevlett.116.061102'],
    ['https://doi.org/10.1103/PhysRevLett.116.061102', '10.1103/physrevlett.116.061102'],
    ['doi: 10.1038/226aa', '10.1038/226aa'],
  ])('accepts %s', (input, expected) => expect(normalizeDoi(input)).toBe(expected));

  it.each(['Einstein 1905', '10.12/short', 'https://example.com/10.1103/x', ''])('rejects %s', (input) =>
    expect(normalizeDoi(input)).toBeUndefined(),
  );
});

describe('checkDoi', () => {
  it('verifies a registered DOI and shows what it is', async () => {
    const fetchImpl = vi.fn<SourceFetch>(() => json(200, CROSSREF_OK));
    const check = await checkDoi('https://doi.org/10.1103/PhysRevLett.116.061102', fetchImpl);
    expect(check).toMatchObject({ verified: true, venue: 'Physical Review Letters', year: 2016 });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://api.crossref.org/works/${encodeURIComponent('10.1103/physrevlett.116.061102')}`,
    );
  });

  it('reports malformed, not-found and unreachable without throwing', async () => {
    expect(await checkDoi('not a doi')).toEqual({ verified: false, reason: 'malformed' });
    expect(await checkDoi('10.1234/missing', () => json(404, {}))).toMatchObject({ verified: false, reason: 'not-found' });
    expect(await checkDoi('10.1234/down', () => json(503, {}))).toMatchObject({ verified: false, reason: 'unreachable' });
    expect(await checkDoi('10.1234/boom', () => Promise.reject(new Error('socket hang up x-key=LEAK')))).toMatchObject({
      verified: false,
      reason: 'unreachable',
    });
  });
});

describe('opVerifySource', () => {
  const verified: SourceCheck = { verified: true, doi: '10.1103/physrevlett.116.061102', title: 'GW150914', venue: 'PRL', year: 2016, authors: ['Abbott'] };

  it('rejects a malformed DOI and an unknown session', async () => {
    const r = await opVerifySource({ doi: 'Einstein 1905' });
    expect(r.kind === 'error' && r.rule).toBe('source:malformed-doi');
    const s = await opVerifySource({ doi: '10.1103/x.1', sessionId: 'nope' }, { sessions: new SessionStore() });
    expect(s.kind === 'error' && s.rule).toBe('session:unknown');
  });

  it('records a verified DOI in the session; an unverifiable one records nothing', async () => {
    const sessions = new SessionStore();
    const id = sessions.create('Does X lower Y?').id;
    const good = ok(await opVerifySource({ doi: '10.1103/PhysRevLett.116.061102', sessionId: id }, { sessions, verifySource: async () => verified }));
    expect(good.verified).toBe(true);
    expect(Object.keys(sessions.get(id)?.verifiedSources ?? {})).toEqual(['10.1103/physrevlett.116.061102']);

    const id2 = sessions.create('Does X lower Y?').id;
    const bad = ok(await opVerifySource({ doi: '10.1234/missing', sessionId: id2 }, { sessions, verifySource: async () => ({ verified: false, reason: 'not-found' }) }));
    expect(bad.verified).toBe(false);
    expect(sessions.get(id2)?.verifiedSources).toBeUndefined();
  });
});

describe('verified sources in scoring', () => {
  const item = (over: Partial<ResolvedEvidence>): ResolvedEvidence => ({ observation: 'randomized trial', kind: 'experiment', ...over });

  it('gives a typed-in source little credit and a verified DOI more', () => {
    const none = evidenceQuality(item({}));
    const asserted = evidenceQuality(item({ source: 'Trial A' }));
    const verified = evidenceQuality(item({ doi: '10.1103/x.1', sourceVerified: true }));
    expect(asserted).toBeGreaterThan(none);
    expect(verified).toBeGreaterThan(asserted);
  });

  it('credits a DOI only after it is verified for this session, and says what is unverified', async () => {
    const sessions = new SessionStore();
    const ctx: CycleContext = { sessions, verifySource: async () => ({ verified: true, doi: '10.1103/physrevlett.116.061102', title: 'Caffeine and reaction time: a randomized trial', venue: 'V', year: 2016, authors: [] }) };
    const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));

    const evidence = [{ observation: 'randomized trial showed faster responses', kind: 'experiment' as const, doi: '10.1103/PhysRevLett.116.061102', sampleSize: 400 }];
    const before = ok(opAnalyze({ verdict: 'yes', evidence, evidenceSearch: SEARCH, sessionId }, ctx));
    expect((before.sourceCheck as { verified: number; unverified: string[] })).toMatchObject({ verified: 0 });
    expect(String((before.sourceCheck as { note: string }).note)).toMatch(/falsify_verify_source/);

    await opVerifySource({ doi: '10.1103/PhysRevLett.116.061102', sessionId }, ctx);
    const after = ok(opAnalyze({ verdict: 'yes', evidence, evidenceSearch: SEARCH, sessionId }, ctx));
    expect((after.sourceCheck as { verified: number }).verified).toBe(1);
    const gain = (after.claimScore as { nonConsensusScore: number }).nonConsensusScore - (before.claimScore as { nonConsensusScore: number }).nonConsensusScore;
    expect(gain).toBeGreaterThan(0);
  });

  it('withholds verified credit from a real paper whose title has nothing to do with the claim', async () => {
    const sessions = new SessionStore();
    const ctx: CycleContext = {
      sessions,
      verifySource: async () => ({ verified: true, doi: '10.1103/physrevlett.116.061102', title: 'Observation of Gravitational Waves from a Binary Black Hole Merger', venue: 'PRL', year: 2016, authors: ['Abbott'] }),
    };
    const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
    await opVerifySource({ doi: '10.1103/PhysRevLett.116.061102', sessionId }, ctx);

    const p = ok(opAnalyze({ verdict: 'yes', evidence: [{ observation: 'randomized trial showed faster responses', kind: 'experiment',     doi: '10.1103/PhysRevLett.116.061102', sampleSize: 400 }], evidenceSearch: SEARCH, sessionId }, ctx));
    const check = p.sourceCheck as { verified: number; possiblyUnrelated: string[]; mismatchNote: string };
    expect(check.verified).toBe(0);
    expect(check.possiblyUnrelated).toEqual(['10.1103/PhysRevLett.116.061102']);
    expect(check.mismatchNote).toMatch(/nothing to do|share nothing/i);
  });
});
