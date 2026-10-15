/**
 * End-to-end over MCP with a server-side session: the caller never supplies
 * `cycleState`, cannot skip a step, cannot confirm a theory without a recorded
 * yes, and a refuted hypothesis lands struck through in the notebook.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import { NotebookStore } from '../../src/memory/notebook.js';
import type { QuantEntry } from '../../src/domain/types.js';

const PRINCIPLES: QuantEntry[] = [
  { id: 'q-noop', principle: 'noop', statement: 'no trigger', triggers: ['zzzznotreal'], failure_guarded: 'none' },
];

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function payloadOf(result: ToolResult): Record<string, unknown> {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('no text content in tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}

const REVIEW = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

describe('MCP cycle with sessions', () => {
  let dir: string;
  let client: Client;
  let notebook: NotebookStore;

  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
    payloadOf((await client.callTool({ name, arguments: args })) as ToolResult);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-mcp-session-'));
    notebook = new NotebookStore(dir, 'test');
    const server = createFalsifyServer({ quantPrinciples: PRINCIPLES, notebook });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'e2e', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterEach(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enforces the cycle server-side and records the outcome', async () => {
    const intake = await call('falsify_intake', { question: 'Does a 200mg caffeine dose lower reaction time?' });
    const sessionId = intake.sessionId as string;
    expect(sessionId).toBeTruthy();

    // Cheating attempt: jump to analysis without a hypothesis or experiment.
    const skipped = await call('falsify_analyze', { verdict: 'yes', evidenceCited: ['reaction time fell'], sessionId });
    expect(skipped.rule).toBe('cycle:illegal-transition');

    // Cheating attempt: lie about the state.
    const lied = await call('falsify_hypothesize', {
      statement: 'Caffeine lowers reaction time',
      predicts: 'faster responses',
      falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
      sessionId,
      cycleState: 'analysis',
    });
    expect(lied.rule).toBe('session:state-mismatch');

    const hyp = await call('falsify_hypothesize', {
      statement: 'Caffeine lowers reaction time',
      predicts: 'faster responses',
      falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
      sessionId,
    });
    expect(hyp.cycleState).toBe('experiment');
    expect(hyp.lockedAt).toBeTruthy();
    expect(Array.isArray(hyp.knowledgeMatches)).toBe(true);

    const exp = await call('falsify_experiment', {
      decisiveEvidence: ['blinded placebo-controlled reaction-time test'],
      couldFail: true,
      sessionId,
    });
    expect(exp.cycleState).toBe('analysis');

    // Cheating attempt: confirm before any yes verdict.
    const early = await call('falsify_review', { ...REVIEW, outcome: 'confirm', sessionId });
    expect(early.rule).toBe('review:yes-verdict-required');

    const no = await call('falsify_analyze', { verdict: 'no', evidenceCited: ['reaction time was unchanged'], sessionId });
    expect(no.cycleState).toBe('review');
    expect(no.predictionLockedAt).toBe(hyp.lockedAt);

    const rev = await call('falsify_review', { ...REVIEW, outcome: 'revise', sessionId });
    expect(rev.cycleState).toBe('hypothesis');
    const items = notebook.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.struck).toBeDefined();

    // Cheating attempt: rescue the claim without saying what changed.
    const rescue = await call('falsify_hypothesize', {
      statement: 'Caffeine lowers reaction time',
      predicts: 'faster responses',
      falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
      sessionId,
    });
    expect(rescue.rule).toBe('honesty:revision-note-required');
  });
});
