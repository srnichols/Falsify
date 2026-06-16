import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../../src/web/server.js';
import { NotebookStore } from '../../src/memory/notebook.js';

/**
 * Drive the whole Cycle of Scientific Enterprise over real HTTP, including the
 * mandatory No-branch (revise loop) and the mandatory review-on-Yes, and record a
 * struck-but-preserved mistake in the notebook (Phase-3 plan, Slice 5).
 */
describe('full cycle over HTTP', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let notebook: NotebookStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-e2e-'));
    notebook = new NotebookStore(dir, 'test');
    server = createWebServer({ notebook });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('runs intake → … → revise loop → … → confirm → theory and keeps a struck mistake', async () => {
    // Intake: a falsifiable question.
    const intake = await post('/api/intake', {
      question: 'Does 10 minutes of morning light lower evening cortisol?',
    });
    expect(intake.status).toBe(200);
    expect(intake.json.cycleState).toBe('hypothesis');

    // Hypothesis (first attempt — will be refuted).
    const hyp1 = await post('/api/hypothesize', {
      statement: 'Morning light lowers evening cortisol',
      predicts: 'lower cortisol at 8pm after morning light',
      falsificationConditions: [{ description: 'no measurable cortisol change after a week of morning light' }],
      cycleState: 'hypothesis',
    });
    expect(hyp1.json.cycleState).toBe('experiment');

    const exp1 = await post('/api/experiment', {
      decisiveEvidence: ['salivary cortisol measured at 8pm before and after intervention'],
      couldFail: true,
      cycleState: 'experiment',
    });
    expect(exp1.json.cycleState).toBe('analysis');

    // Analysis says NO — take the mandatory No branch to Review.
    const ana1 = await post('/api/analyze', {
      verdict: 'no',
      evidenceCited: ['cortisol unchanged within noise'],
      cycleState: 'analysis',
    });
    expect(ana1.json.cycleState).toBe('review');

    // Record the refuted hypothesis as a notebook mistake, then strike it.
    const recorded = notebook.record({ kind: 'mistake', text: 'Morning light lowers evening cortisol' });
    notebook.strikeThrough(recorded.id, 'refuted: cortisol unchanged');

    // Review: revise loops back to Hypothesis.
    const rev1 = await post('/api/review', {
      q1Methods: 'methods were sound',
      q2Hypothesis: 'hypothesis too strong',
      q3Theory: 'theory intact',
      outcome: 'revise',
      cycleState: 'review',
    });
    expect(rev1.json.cycleState).toBe('hypothesis');

    // Second hypothesis through to a YES.
    const hyp2 = await post('/api/hypothesize', {
      statement: 'Morning light advances circadian phase',
      predicts: 'earlier melatonin onset after a week of morning light',
      falsificationConditions: [{ description: 'no shift in melatonin onset' }],
      cycleState: 'hypothesis',
    });
    expect(hyp2.json.cycleState).toBe('experiment');

    const exp2 = await post('/api/experiment', {
      decisiveEvidence: ['dim-light melatonin onset measured before and after'],
      couldFail: true,
      cycleState: 'experiment',
    });
    expect(exp2.json.cycleState).toBe('analysis');

    // Analysis says YES — NOT final; review is required.
    const ana2 = await post('/api/analyze', {
      verdict: 'yes',
      evidenceCited: ['melatonin onset 30 min earlier'],
      cycleState: 'analysis',
    });
    expect(ana2.json.reviewRequired).toBe(true);
    expect(ana2.json.cycleState).toBe('analysis');

    // Review confirm — finalize the Theory.
    const rev2 = await post('/api/review', {
      q1Methods: 'methods sound',
      q2Hypothesis: 'hypothesis held',
      q3Theory: 'theory intact',
      outcome: 'confirm',
      cycleState: 'analysis',
    });
    expect(rev2.json.cycleState).toBe('theory');

    // The notebook keeps the struck mistake legible, not deleted.
    const list = await fetch(`${base}/api/notebook`);
    const items = ((await list.json()) as { items: { text: string; struck?: unknown }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Morning light lowers evening cortisol');
    expect(items[0]?.struck).toBeDefined();
  });
});
