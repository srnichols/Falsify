/**
 * Slice 2 tests: `falsify_hypothesize` enforces the honesty rule and applies the
 * quantitative lens. Quant principles are injected so the suite never reads disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import type { FalsifyServerDeps } from '../../src/mcp/deps.js';
import type { QuantEntry } from '../../src/domain/types.js';

const TEST_PRINCIPLES: QuantEntry[] = [
  {
    id: 'q-base-rate',
    principle: 'Base-rate neglect',
    statement: 'A test result must be read against the base rate of the condition.',
    triggers: ['percent', 'rare'],
    failure_guarded: 'base-rate neglect',
  },
];

async function connect(deps: FalsifyServerDeps = {}): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createFalsifyServer(deps);
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

describe('falsify_hypothesize — Slice 2', () => {
  let ctx: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    ctx = await connect({ quantPrinciples: TEST_PRINCIPLES });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('rejects a hypothesis with no falsification conditions, citing the honesty rule', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_hypothesize',
      arguments: {
        statement: 'Caffeine improves alertness.',
        predicts: 'Reaction times will drop after a dose.',
        falsificationConditions: [],
      },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('honesty:falsification-condition-required');
  });

  it('rejects a hypothesis whose only condition has an empty description', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_hypothesize',
      arguments: {
        statement: 'Caffeine improves alertness.',
        predicts: 'Reaction times will drop after a dose.',
        falsificationConditions: [{ description: '' }],
      },
    });
    expect(res.isError).toBe(true);
    const payload = payloadOf(res as never);
    expect(payload.rule).toBe('honesty:falsification-condition-required');
  });

  it('accepts a valid hypothesis and advances the cycle to experiment', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_hypothesize',
      arguments: {
        statement: 'Caffeine improves alertness.',
        predicts: 'Reaction times will drop after a 200mg dose.',
        falsificationConditions: [
          { description: 'Reaction times do not change or increase after the dose.' },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const payload = payloadOf(res as never);
    expect(payload.cycleState).toBe('experiment');
    expect(payload.legalNext).toEqual(['analyze']);
    expect(payload.hypothesis).toBeDefined();
  });

  it('surfaces a quantitative flag when a trigger word appears', async () => {
    const res = await ctx.client.callTool({
      name: 'falsify_hypothesize',
      arguments: {
        statement: 'The screening test is 99 percent accurate.',
        predicts: 'A positive result means the patient has the condition.',
        falsificationConditions: [{ description: 'Confirmatory testing shows the positive was false.' }],
      },
    });
    const payload = payloadOf(res as never);
    const quantFlags = payload.quantFlags as Array<{ id: string; matchedTriggers: string[] }>;
    expect(quantFlags).toHaveLength(1);
    expect(quantFlags[0]?.id).toBe('q-base-rate');
    expect(quantFlags[0]?.matchedTriggers).toContain('percent');
  });
});
