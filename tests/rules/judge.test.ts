import { describe, it, expect, vi } from 'vitest';
import {
  createOpenAiJudge,
  extractJson,
  judgeConsensusAppeal,
  judgeFalsifiability,
  judgeSupport,
} from '../../src/rules/judge.js';
import type { Judge, JudgeFetch } from '../../src/rules/judge.js';
import { checkDoi } from '../../src/rules/sourceCheck.js';
import type { SourceFetch } from '../../src/rules/sourceCheck.js';
import { adviseAnalysis, adviseIntake } from '../../src/cycle/advice.js';
import { opAnalyze, opExperiment, opHypothesize, opIntake } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import { opVerifySource } from '../../src/cycle/verify.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import { SEARCH } from '../helpers/evidence.js';
import { evaluateJudge } from '../../src/cli/calibrateJudge.js';

const fake = (reply: string | ((system: string, user: string) => string)): Judge => ({
  model: 'fake-judge',
  complete: async (system, user) => (typeof reply === 'string' ? reply : reply(system, user)),
});
const failing: Judge = { model: 'down', complete: async () => Promise.reject(new Error('ECONNREFUSED sk-LEAK')) };

function ok(result: OpResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.rule}`);
  return result.payload;
}

describe('createOpenAiJudge', () => {
  const reply = (content: unknown): ReturnType<JudgeFetch> =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

  it('posts a deterministic chat request with the key as a bearer token', async () => {
    const fetchImpl = vi.fn<JudgeFetch>(() => reply('{"ok":true}'));
    const judge = createOpenAiJudge({ baseUrl: 'http://127.0.0.1:11434/v1/', model: 'qwen2.5:32b', apiKey: 'sk-test', fetchImpl });
    expect(await judge.complete('sys', 'usr')).toBe('{"ok":true}');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'qwen2.5:32b', temperature: 0, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }] });
  });

  it('reports a failed request by status only and rejects a reply with no content', async () => {
    const bad: JudgeFetch = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'sk-LEAK' }) });
    const error = await createOpenAiJudge({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'sk-LEAK', fetchImpl: bad }).complete('a', 'b').catch((e: unknown) => e as Error);
    expect(error.message).toBe('judge request failed with status 500');
    await expect(createOpenAiJudge({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: () => reply(null) }).complete('a', 'b')).rejects.toThrow(/no message content/);
  });
});

describe('extractJson', () => {
  it('finds JSON through fences and chatter, and returns undefined for none', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` done')).toEqual({ a: 1 });
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('{ broken')).toBeUndefined();
  });
});

describe('the judge functions never throw and never trust an unreadable reply', () => {
  it('judgeFalsifiability reads a reply, and degrades to unclear on garbage or failure', async () => {
    expect(await judgeFalsifiability(fake('{"falsifiable":"no","reason":"value claim"}'), 'x')).toEqual({ falsifiable: 'no', reason: 'value claim' });
    expect((await judgeFalsifiability(fake('I think so'), 'x')).falsifiable).toBe('unclear');
    const down = await judgeFalsifiability(failing, 'x');
    expect(down.falsifiable).toBe('unclear');
    expect(JSON.stringify(down)).not.toContain('LEAK');
  });

  it('judgeConsensusAppeal returns a boolean or unclear', async () => {
    expect((await judgeConsensusAppeal(fake('{"appeal":true,"reason":"authority"}'), 'x')).appeal).toBe(true);
    expect((await judgeConsensusAppeal(fake('{"appeal":"maybe"}'), 'x')).appeal).toBe('unclear');
    expect((await judgeConsensusAppeal(failing, 'x')).appeal).toBe('unclear');
  });

  const ABSTRACT = 'We observed a transient signal in two detectors.\nIt matches the predicted waveform.';

  it('judgeSupport trusts a "yes" only when its quote is really in the abstract', async () => {
    const real = await judgeSupport(fake('{"supports":"yes","quote":"it matches the PREDICTED waveform","reason":"stated"}'), 'obs', ABSTRACT);
    expect(real.supports).toBe('yes');
    expect(real.quote).toBe('it matches the PREDICTED waveform');

    const near = await judgeSupport(
      fake('{"supports":"yes","quote":"The signal matches the waveform predicted by general relativity","reason":"stated"}'),
      'obs',
      'On a day the detectors saw a signal. It matches the waveform predicted by general relativity for the merger.',
    );
    expect(near.supports).toBe('yes'); // "The signal" for "It": a faithful quote, not an invented one

    const invented = await judgeSupport(fake('{"supports":"yes","quote":"the effect was huge","reason":"stated"}'), 'obs', ABSTRACT);
    expect(invented.supports).toBe('unclear');
    expect(invented.reason).toMatch(/not in the abstract/);

    const stitched = await judgeSupport(fake('{"supports":"yes","quote":"We observed a signal and it proves the theory is true for everyone everywhere","reason":"x"}'), 'obs', ABSTRACT);
    expect(stitched.supports).toBe('unclear');

    expect((await judgeSupport(fake('{"supports":"yes"}'), 'obs', ABSTRACT)).supports).toBe('unclear');
    expect((await judgeSupport(fake('{"supports":"no","reason":"other topic"}'), 'obs', ABSTRACT)).supports).toBe('no');
  });
});

describe('advisory hooks add advice and change nothing else', () => {
  const ctxWith = (reply: Judge): CycleContext => ({ sessions: new SessionStore(), judge: reply });

  it('adviseIntake flags a disagreement but keeps the keyword verdict and the session', async () => {
    const ctx = ctxWith(fake('{"falsifiable":"no","reason":"no observation could refute it"}'));
    const question = 'The universe was created five minutes ago with all our memories intact.';
    const base = opIntake({ question }, ctx);
    const advised = ok(await adviseIntake(question, base, ctx));
    expect(advised.falsifiable).toBe(true); // the keyword verdict stands
    expect(advised.sessionId).toBe(ok(base).sessionId);
    expect(advised.judgeDisagrees).toBe(true);
    expect(advised.judgeAdvice).toMatchObject({ falsifiable: 'no', model: 'fake-judge' });
    expect(String((advised.judgeAdvice as { note: string }).note)).toMatch(/can be wrong/);
  });

  it('returns the result untouched with no judge, on an error, or when the judge agrees', async () => {
    const base = opIntake({ question: 'Does caffeine lower reaction time?' });
    expect(await adviseIntake('q', base, undefined)).toBe(base);
    const error = opIntake({ question: 'q', cycleState: 'analysis' });
    expect(await adviseIntake('q', error, ctxWith(fake('{"falsifiable":"no"}')))).toBe(error);
    const agrees = ok(await adviseIntake('q', base, ctxWith(fake('{"falsifiable":"yes","reason":"empirical"}'))));
    expect(agrees.judgeDisagrees).toBeUndefined();
    expect(agrees.judgeAdvice).toBeDefined();
  });

  it('adviseAnalysis lists evidence the judge reads as an appeal, without reclassifying it', async () => {
    const ctx = ctxWith(fake((_s, user) => (user.includes('luminaries') ? '{"appeal":true,"reason":"authority"}' : '{"appeal":false}')));
    const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
    const analysis = opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell versus placebo', 'the leading luminaries all hold this view'], evidenceSearch: SEARCH, sessionId }, ctx);
    const advised = ok(await adviseAnalysis(analysis, ctx));
    expect(advised.possibleConsensusAppeals).toEqual([{ observation: 'the leading luminaries all hold this view', reason: 'authority' }]);
    expect(advised.consensusCitedAsEvidence).toBeUndefined();
    expect(advised.cycleState).toBe('analysis');
  });
});

describe('source support advice', () => {
  const verified = (abstract?: string) => async () => ({ verified: true as const, doi: '10.1/x', title: 'GW observation', venue: 'PRL', year: 2016, authors: [], ...(abstract !== undefined ? { abstract } : {}) });

  it('checks the abstract against the cited observation and remembers a "no"', async () => {
    const sessions = new SessionStore();
    const sessionId = sessions.create('Does X lower Y?').id;
    const ctx: CycleContext = { sessions, verifySource: verified('Two detectors saw a signal.'), judge: fake('{"supports":"no","reason":"different subject"}') };
    const p = ok(await opVerifySource({ doi: '10.1103/x.1', sessionId, observation: 'caffeine lowers reaction time' }, ctx));
    expect(p.supportAdvice).toMatchObject({ supports: 'no', model: 'fake-judge' });
    expect(sessions.get(sessionId)?.verifiedSources?.['10.1103/x.1']?.support).toBe('no');
  });

  it('says so when no abstract is published, and does nothing without a judge or an observation', async () => {
    const ctx: CycleContext = { verifySource: verified(), judge: fake('{"supports":"yes"}') };
    const none = ok(await opVerifySource({ doi: '10.1103/x.1', observation: 'o' }, ctx));
    expect(none.hasAbstract).toBe(false);
    expect((none.supportAdvice as { reason: string }).reason).toMatch(/No abstract/);
    expect(ok(await opVerifySource({ doi: '10.1103/x.1' }, ctx)).supportAdvice).toBeUndefined();
    expect(ok(await opVerifySource({ doi: '10.1103/x.1', observation: 'o' }, { verifySource: verified('a b c') })).supportAdvice).toBeUndefined();
  });
});

describe('abstract retrieval', () => {
  const json = (body: unknown): ReturnType<SourceFetch> => Promise.resolve({ ok: true, status: 200, json: async () => body });

  it('takes the abstract from Crossref, stripping markup', async () => {
    const fetchImpl: SourceFetch = () => json({ message: { title: ['T'], abstract: '<jats:title>Abstract</jats:title><jats:p>We saw <i>a</i> signal.</jats:p>' } });
    expect(await checkDoi('10.1103/x.1', fetchImpl)).toMatchObject({ verified: true, abstract: 'We saw a signal.' });
  });

  it('falls back to OpenAlex, and a failure there never un-verifies the source', async () => {
    const urls: string[] = [];
    const viaOpenAlex: SourceFetch = (url) => {
      urls.push(url);
      return url.includes('openalex') ? json({ abstract_inverted_index: { Hello: [0], world: [1] } }) : json({ message: { title: ['T'] } });
    };
    expect(await checkDoi('10.1103/x.1', viaOpenAlex)).toMatchObject({ verified: true, abstract: 'Hello world' });
    expect(urls.some((u) => u.includes('openalex'))).toBe(true);

    const openAlexDown: SourceFetch = (url) => (url.includes('openalex') ? Promise.reject(new Error('down')) : json({ message: { title: ['T'] } }));
    const r = await checkDoi('10.1103/x.1', openAlexDown);
    expect(r.verified).toBe(true);
    expect('abstract' in r && r.abstract).toBeFalsy();
  });
});

describe('evaluateJudge', () => {
  it('counts correct, unclear and wrong answers and compares with the keyword baseline', async () => {
    const cases = {
      note: 'n',
      falsifiability: [
        { claim: 'Water boils lower at altitude.', falsifiable: true },
        { claim: 'A bachelor is an unmarried man.', falsifiable: false },
      ],
      consensus: [
        { text: 'Everyone knows it.', appeal: true },
        { text: 'Output equalled input.', appeal: false },
      ],
      support: [{ doi: '10.1/x', title: 't', abstract: 'Two detectors saw a signal.', observation: 'o', supports: 'yes' as const }],
    };
    const judge = fake((system) => {
      if (system.includes('falsifiable in')) return '{"falsifiable":"yes","reason":"r"}';
      if (system.includes('appeal to authority')) return '{"appeal":false,"reason":"r"}';
      return '{"supports":"yes","quote":"Two detectors saw a signal.","reason":"r"}';
    });
    const [fals, cons, sup] = await evaluateJudge(judge, cases);
    expect(fals).toMatchObject({ total: 2, judgeCorrect: 1, judgeUnclear: 0 });
    expect(fals?.misses[0]).toContain('bachelor');
    expect(cons).toMatchObject({ total: 2, judgeCorrect: 1, baselineCorrect: 2 });
    expect(sup).toMatchObject({ total: 1, judgeCorrect: 1, baselineCorrect: undefined });
  });
});
