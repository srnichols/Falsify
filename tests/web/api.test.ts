import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../../src/web/api.js';
import type { WebDeps } from '../../src/web/api.js';
import { NotebookStore } from '../../src/memory/notebook.js';
import type { MemoryReader } from '../../src/memory/openbrainClient.js';

describe('handleRequest', () => {
  let dir: string;
  let deps: WebDeps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-api-'));
    deps = { notebook: new NotebookStore(dir, 'test') };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('advances a falsifiable question on POST /api/intake', async () => {
    const res = await handleRequest('POST', '/api/intake', { question: 'Does X reduce Y within 1 day?' }, deps);
    expect(res.status).toBe(200);
    expect(res.json.cycleState).toBe('hypothesis');
  });

  it('returns 400 on a malformed body', async () => {
    const res = await handleRequest('POST', '/api/intake', { notAQuestion: 1 }, deps);
    expect(res.status).toBe(400);
    expect(res.json.rule).toBe('request:invalid-body');
  });

  it('returns 422 with the named honesty rule for a hypothesis with no falsification condition', async () => {
    const res = await handleRequest(
      'POST',
      '/api/hypothesize',
      { statement: 'X causes Y', predicts: 'more X more Y', falsificationConditions: [] },
      deps,
    );
    expect(res.status).toBe(422);
    expect(res.json.rule).toBe('honesty:falsification-condition-required');
  });

  it('returns 422 for an experiment that cannot fail', async () => {
    const res = await handleRequest(
      'POST',
      '/api/experiment',
      { couldFail: false, decisiveEvidence: ['x'] },
      deps,
    );
    expect(res.status).toBe(422);
    expect(res.json.rule).toBe('honesty:experiment-must-be-able-to-fail');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await handleRequest('POST', '/api/nope', {}, deps);
    expect(res.status).toBe(404);
    expect(res.json.rule).toBe('request:not-found');
  });

  it('records and lists notebook entries, and strikes one through', async () => {
    const rec = await handleRequest('POST', '/api/notebook', { kind: 'mistake', text: 'wrong claim' }, deps);
    expect(rec.status).toBe(200);
    const item = rec.json.item as { id: string };

    const struck = await handleRequest('POST', '/api/notebook/strike', { id: item.id, reason: 'refuted' }, deps);
    expect(struck.json.struck).toBe(true);

    const list = await handleRequest('GET', '/api/notebook', undefined, deps);
    const items = list.json.items as { struck?: unknown }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.struck).toBeDefined();
  });

  it('recall degrades to 422 without leaking the key when the reader throws', async () => {
    const reader: MemoryReader = {
      recall: async () => {
        throw new Error('ECONNREFUSED key=SUPER_SECRET_KEY');
      },
    };
    const res = await handleRequest('POST', '/api/recall', { query: 'x' }, { ...deps, memory: reader });
    expect(res.status).toBe(422);
    expect(res.json.rule).toBe('recall:brain-unreachable');
    expect(JSON.stringify(res.json)).not.toContain('SUPER_SECRET_KEY');
  });

  it('recall returns results from an injected reader', async () => {
    const reader: MemoryReader = { recall: async () => [{ id: 1 }, { id: 2 }] };
    const res = await handleRequest('POST', '/api/recall', { query: 'falsify' }, { ...deps, memory: reader });
    expect(res.status).toBe(200);
    expect(res.json.count).toBe(2);
  });
});
