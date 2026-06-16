/**
 * Slice 3 tests: `falsify_experiment` (could-fail rule) and `falsify_analyze`
 * (No-branch routing + mandatory review-on-Yes).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createFalsifyServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function payloadOf(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('no text content in tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('falsify_experiment — Slice 3', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    ctx = await connect();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('rejects an experiment that cannot fail', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_experiment',
      arguments: { decisiveEvidence: ['anything'], couldFail: false },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('honesty:experiment-must-be-able-to-fail');
  });

  it('rejects an experiment with no decisive evidence', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_experiment',
      arguments: { decisiveEvidence: [], couldFail: true },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('honesty:experiment-needs-decisive-evidence');
  });

  it('accepts a could-fail experiment and advances to analysis', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_experiment',
      arguments: {
        decisiveEvidence: ['Double-blind reaction-time measurements before and after dosing.'],
        couldFail: true,
      },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.cycleState).toBe('analysis');
    expect(payload.legalNext).toEqual(['confirm', 'refute']);
  });
});

describe('falsify_analyze — Slice 3', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    ctx = await connect();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('routes a "no" verdict to the Review state', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_analyze',
      arguments: { verdict: 'no', evidenceCited: ['Reaction times were unchanged.'] },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.cycleState).toBe('review');
    expect(payload.legalNext).toEqual(['revise']);
  });

  it('does NOT finalize a "yes" — flags reviewRequired and stays in analysis', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_analyze',
      arguments: { verdict: 'yes', evidenceCited: ['Reaction times dropped significantly.'] },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.reviewRequired).toBe(true);
    expect(payload.nextTool).toBe('falsify_review');
    expect(payload.cycleState).toBe('analysis');
  });

  it('rejects a verdict with no cited evidence', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_analyze',
      arguments: { verdict: 'yes', evidenceCited: [] },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('analysis:evidence-required');
  });
});
