import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import { handleRequest } from '../../src/web/api.js';
import { createWebServer } from '../../src/web/server.js';
import { MCP_TOOL_NAMES } from '../../src/web/dashboard.js';
import { SessionStore } from '../../src/cycle/session.js';
import { OutcomeStore } from '../../src/memory/outcomes.js';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { CLEAN_YES } from '../helpers/evidence.js';
import { runMirror } from '../helpers/mirror.js';

const ok = (r: OpResult): Record<string, unknown> => {
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.rule}: ${r.error}`);
  return r.payload;
};

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

function confirmed(ctx: CycleContext): string {
  const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
  ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId }, [], ctx));
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId }, ctx));
  ok(opAnalyze({ ...CLEAN_YES, sessionId }, ctx));
  ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
  return sessionId;
}

describe('GET /api/status', () => {
  it('reports the real corpus, the ten tools, and which optional services are on', async () => {
    const ctx: CycleContext = { sessions: new SessionStore(), requireSession: true };
    const res = await handleRequest('GET', '/api/status', undefined, ctx);
    expect(res.status).toBe(200);
    const corpus = res.json.corpus as { total: number; byTier: Record<string, number> };
    const files = loadAllKnowledge();
    expect(corpus.total).toBe(Object.values(files).reduce((n, f) => n + f.entries.length, 0));
    expect(corpus.byTier.contested).toBe(files.contested.entries.length);
    expect((res.json.tools as string[]).length).toBe(10);
    const settings = res.json.settings as { requireSession: boolean; judge: { enabled: boolean }; embeddings: { enabled: boolean }; weights: { consensus: number } };
    expect(settings.requireSession).toBe(true);
    expect(settings.judge.enabled).toBe(false);
    expect(settings.embeddings.enabled).toBe(false);
    expect(settings.weights.consensus).toBeLessThan(Math.min(settings.weights.evidence, settings.weights.falsifiability));
  });

  it('lists exactly the tools the MCP server registers', async () => {
    const server = createFalsifyServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'status-test', version: '0.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    const { tools } = await client.listTools();
    await client.close();
    await server.close();
    expect([...MCP_TOOL_NAMES].sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

describe('GET /api/sessions', () => {
  it('summarises every inquiry, newest first, with the status a confirmed theory earned', async () => {
    const ctx: CycleContext = { sessions: new SessionStore() };
    const first = confirmed(ctx);
    const second = ok(opIntake({ question: 'Does caffeine change heart rate?' }, ctx)).sessionId as string;

    const res = await handleRequest('GET', '/api/sessions', undefined, ctx);
    const sessions = res.json.sessions as { id: string; state: string; epistemicStatus?: string; verdict?: string }[];
    expect(sessions.map((s) => s.id)).toEqual([second, first]);
    const done = sessions.find((s) => s.id === first);
    expect(done?.state).toBe('theory');
    expect(done?.epistemicStatus).toBe('provisional');
    expect(done?.verdict).toBe('yes');
    expect(sessions.find((s) => s.id === second)?.epistemicStatus).toBeUndefined();
  });

  it('includes the mirror comparison when a session is requested', async () => {
    const ctx: CycleContext = { sessions: new SessionStore() };
    const id = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
    ok(opHypothesize({ statement: 'Caffeine lowers reaction time', predicts: 'faster responses', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }], sessionId: id }, [], ctx));
    ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId: id }, ctx));
    ok(opAnalyze({ ...CLEAN_YES, sessionId: id }, ctx));
    runMirror(ctx, id, 'no');

    const res = await handleRequest('POST', '/api/session', { sessionId: id }, ctx);
    expect(res.status).toBe(200);
    const mirror = res.json.mirror as { linked: boolean; completed: boolean };
    expect(mirror.linked).toBe(true);
    expect(mirror.completed).toBe(true);

    const plain = ok(opIntake({ question: 'Does caffeine change heart rate?' }, ctx)).sessionId as string;
    expect((await handleRequest('POST', '/api/session', { sessionId: plain }, ctx)).json.mirror).toBeUndefined();
  });

  it('reads sessions that were saved by an earlier process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'falsify-list-'));
    try {
      const writer = new SessionStore(dir);
      const id = writer.create('Does X lower Y?').id;
      const reader = new SessionStore(dir);
      expect(reader.list().map((s) => s.id)).toEqual([id]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/knowledge', () => {
  const get = (query: string) => handleRequest('GET', '/api/knowledge', undefined, {}, new URLSearchParams(query));

  it('lists the whole corpus with facets when nothing is filtered', async () => {
    const res = await get('limit=200');
    const total = Object.values(loadAllKnowledge()).reduce((n, f) => n + f.entries.length, 0);
    expect(res.json.total).toBe(total);
    expect(res.json.items as unknown[]).toHaveLength(Math.min(200, total));
    const facets = res.json.facets as { tiers: Record<string, number>; fields: Record<string, number> };
    expect(Object.keys(facets.tiers).sort()).toEqual(['bedrock', 'contested', 'established', 'quantitative', 'refuted']);
    expect(facets.fields.physics).toBeGreaterThan(0);
  });

  it('searches by words in the title, keywords and body, best match first', async () => {
    const res = await get('q=hippocampus memory');
    const items = res.json.items as { id: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.id)).toContain('established.neuroscience.hippocampus_declarative_memory');
    expect(await get('q=zzzzqqqq').then((r) => r.json.total)).toBe(0);
  });

  it('filters by tier and field and counts what remains', async () => {
    const res = await get('tier=contested&field=economics');
    const items = res.json.items as { tier: string; field: string }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((i) => i.tier === 'contested' && i.field === 'economics')).toBe(true);
  });

  it('pages results', async () => {
    const page1 = await get('limit=5&offset=0');
    const page2 = await get('limit=5&offset=5');
    const ids1 = (page1.json.items as { id: string }[]).map((i) => i.id);
    const ids2 = (page2.json.items as { id: string }[]).map((i) => i.id);
    expect(ids1).toHaveLength(5);
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
  });

  it('returns one full entry, or a 404 for an unknown id', async () => {
    const found = await handleRequest('GET', '/api/knowledge/entry', undefined, {}, new URLSearchParams('id=contested.climate.equilibrium_sensitivity'));
    expect(found.status).toBe(200);
    expect(found.json.tier).toBe('contested');
    expect((found.json.entry as { positions: unknown[] }).positions.length).toBeGreaterThanOrEqual(3);
    const missing = await handleRequest('GET', '/api/knowledge/entry', undefined, {}, new URLSearchParams('id=nope'));
    expect(missing.status).toBe(404);
    expect(missing.json.rule).toBe('request:not-found');
  });
});

describe('GET /api/outcomes', () => {
  it('says so when outcome tracking is not configured', async () => {
    const res = await handleRequest('GET', '/api/outcomes', undefined, {});
    expect(res.json.available).toBe(false);
  });

  it('reports the log and refuses to print an accuracy without enough data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'falsify-out-'));
    try {
      const ctx: CycleContext = { sessions: new SessionStore(), outcomes: new OutcomeStore(dir) };
      const res = await handleRequest('GET', '/api/outcomes', undefined, ctx);
      expect(res.json.available).toBe(true);
      expect((res.json.report as { sufficient: boolean; message: string }).sufficient).toBe(false);
      expect((res.json.report as { message: string }).message).toMatch(/Not enough/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('static responses', () => {
  let server: Server;
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends a locked-down content security policy and serves nested modules', async () => {
    server = createWebServer({});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await fetch(`${base}/`);
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const dom = await fetch(`${base}/js/dom.js`);
    expect(dom.status).toBe(200);
    expect(dom.headers.get('content-type')).toContain('text/javascript');
  });
});
