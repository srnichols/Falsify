/**
 * Slice 4 tests: `falsify_review` enforces the three questions and routes the
 * loop-back (revise) vs. the finalize (confirm).
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

const ANSWERS = {
  q1Methods: 'The measurement protocol was sound and blinded.',
  q2Hypothesis: 'The hypothesis over-specified the dose response.',
  q3Theory: 'The underlying theory still holds.',
};

describe('falsify_review — Slice 4', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    ctx = await connect();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('rejects a review with a blank answer', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_review',
      arguments: { ...ANSWERS, q2Hypothesis: '   ', outcome: 'revise' },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('review:three-questions-required');
  });

  it('loops back to hypothesis on revise (the No branch)', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_review',
      arguments: { ...ANSWERS, outcome: 'revise', cycleState: 'review' },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.cycleState).toBe('hypothesis');
    expect(payload.legalNext).toEqual(['experiment']);
  });

  it('finalizes a Theory on confirm (terminal, no further events)', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_review',
      arguments: { ...ANSWERS, outcome: 'confirm', cycleState: 'analysis' },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.cycleState).toBe('theory');
    expect(payload.legalNext).toEqual([]);
  });

  it('rejects confirm from a non-analysis state as an illegal transition', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_review',
      arguments: { ...ANSWERS, outcome: 'confirm', cycleState: 'review' },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('cycle:illegal-transition');
  });
});
