/**
 * Slice 5 tests: `falsify_recall` returns hits from an injected fake reader,
 * degrades to a structured error when the reader throws, and never leaks the key.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import type { FalsifyServerDeps, MemoryReader } from '../../src/mcp/deps.js';

async function connect(deps: FalsifyServerDeps): Promise<{ client: Client; close: () => Promise<void> }> {
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

function rawText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('');
}

describe('falsify_recall — Slice 5', () => {
  it('returns hits from the injected memory reader', async () => {
    const reader: MemoryReader = {
      recall: () => Promise.resolve([{ content: 'consensus is a signal, not a verdict' }]),
    };
    const ctx = await connect({ memory: reader });
    try {
      const res = await ctx.client.callTool({
        name: 'falsify_recall',
        arguments: { query: 'how much weight does consensus carry?' },
      });
      expect(res.isError).toBeFalsy();
      const payload = payloadOf(res as never);
      expect(payload.count).toBe(1);
      expect(Array.isArray(payload.results)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('degrades to a structured error when the reader throws, leaking no key', async () => {
    const SECRET = 'DEADBEEFCAFEKEY';
    const reader: MemoryReader = {
      recall: () => Promise.reject(new Error(`HTTP 500 x-brain-key=${SECRET}`)),
    };
    const ctx = await connect({ memory: reader });
    try {
      const res = await ctx.client.callTool({
        name: 'falsify_recall',
        arguments: { query: 'anything' },
      });
      expect(res.isError).toBe(true);
      const payload = payloadOf(res as never);
      expect(payload.rule).toBe('recall:brain-unreachable');
      expect(rawText(res as never)).not.toContain(SECRET);
    } finally {
      await ctx.close();
    }
  });
});
