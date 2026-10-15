import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error the harness is a plain .mjs script with no type declarations
import { scoreRun } from '../../scripts/eval-inquiry.mjs';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function dataDir(sessions: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-eval-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'sessions'));
  sessions.forEach((s, i) => writeFileSync(join(dir, 'sessions', `${i}.json`), JSON.stringify(s)));
  return dir;
}

const analysed = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  state: 'theory',
  hypothesis: { falsificationConditions: [{}, {}, {}] },
  analysis: {
    verdict: 'yes',
    evidence: [
      { observation: 'a', sourceVerified: true, pValue: 0.01 },
      { observation: 'b', replicated: true },
      { observation: 'c', replicationDoi: '10.1000/x', replicated: false },
    ],
    evidenceSearch: { description: 'searched pubmed and crossref for trials and null results', contraryFound: 2 },
  },
  ...over,
});

describe('eval harness scoring', () => {
  it('counts what the server recorded and the tool calls in the transcript', () => {
    const data = dataDir([analysed('a'), analysed('b', { state: 'hypothesis', mirrorOf: 'a', analysis: undefined })]);
    const transcript = [
      '● falsify_verify_source (MCP: falsify) · doi: "10.1/x"',
      '● falsify_verify_source (MCP: falsify) · doi: "10.1/y"',
      '  └ {"doi":"10.1/y","verified":false,"reason":"not-found"}',
      '● Fetching web content https://api.crossref.org/works?query=x',
      '✗ falsify_analyze (MCP: falsify) {"error":"e","rule":"analysis:search-disclosure-required"}',
    ].join('\n');

    const s = scoreRun(data, transcript);

    expect(s.sessions).toBe(2);
    expect(s.reachedAnalysis).toBe(1);
    expect(s.confirmed).toBe(1);
    expect(s.mirrorLinked).toBe(true);
    expect(s.mirrorCompleted).toBe(true);
    expect(s.verifyCalls).toBe(2);
    expect(s.doiNotFound).toBe(1);
    expect(s.webCalls).toBe(1);
    expect(s.refusals).toBe(1);
    expect(s.evidenceItems).toBe(3);
    expect(s.sourcesVerified).toBe(1);
    expect(s.pValuesSupplied).toBe(1);
    expect(s.replicationClaimed).toBe(2);
    expect(s.replicationCredited).toBe(1);
    expect(s.searchWords).toBe(9);
    expect(s.contraryReported).toBe(2);
    expect(s.falsifiers).toBe(3);
    expect(s.verdicts).toBe('yes');
  });

  it('reports an empty run honestly', () => {
    const s = scoreRun(join(tmpdir(), 'falsify-no-such-dir'), '');
    expect(s.sessions).toBe(0);
    expect(s.verdicts).toBe('-');
    expect(s.mirrorLinked).toBe(false);
  });
});
