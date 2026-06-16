/**
 * Slice 1 integration tests: a real MCP `Client` connected to the real Falsify
 * server over an in-memory transport pair (no process spawn, no network).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import { CONSENSUS_CHALLENGE } from '../../src/mcp/tools/intake.js';

/** Connect a fresh client to a fresh server; return both for the test to drive. */
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

/** Parse the JSON payload from a tool result's first text block. */
function payloadOf(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('no text content in tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('Falsify MCP server — Slice 1', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    ctx = await connect();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('advertises falsify_intake with a description and input schema', async () => {
    const { tools } = await ctx.client.listTools();
    const intake = tools.find((t) => t.name === 'falsify_intake');
    expect(intake).toBeDefined();
    expect(intake?.description).toBeTruthy();
    expect(intake?.inputSchema).toBeDefined();
  });

  it('registers exactly the six falsify_* tools', async () => {
    const { tools } = await ctx.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'falsify_analyze',
        'falsify_experiment',
        'falsify_hypothesize',
        'falsify_intake',
        'falsify_recall',
        'falsify_review',
      ].sort(),
    );
  });

  it('passes a plain empirical question and advances to hypothesis', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_intake',
      arguments: { question: 'Does caffeine reduce reaction time in adults?' },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.falsifiable).toBe(true);
    expect(payload.cycleState).toBe('hypothesis');
    expect(payload.legalNext).toEqual(['experiment']);
  });

  it('flags a consensus appeal and answers it with the challenge', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_intake',
      arguments: { question: 'The science is settled and experts agree that this drug works.' },
    });
    const payload = payloadOf(res as never);
    expect(payload.consensusAppeal).toBe(true);
    expect(payload.challenge).toBe(CONSENSUS_CHALLENGE);
  });

  it('flags a normative claim as outside the method and stays in intake', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_intake',
      arguments: { question: 'Society should ban all single-use plastics.' },
    });
    const payload = payloadOf(res as never);
    expect(payload.falsifiable).toBe(false);
    expect(payload.reframedHint).toBeTruthy();
    expect(payload.cycleState).toBeUndefined();
  });

  it('returns a structured error (not a crash) for an illegal cycle state', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_intake',
      arguments: { question: 'Does X cause Y?', cycleState: 'analysis' },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('cycle:illegal-transition');
  });
});
