import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenBrainMcpClient,
  foldMetadataIntoContent,
  type McpSession,
  type McpConnect,
} from '../../src/memory/openbrainMcpClient.js';
import type { BrainMemory } from '../../src/memory/openbrainClient.js';
import type { FalsifyConfig } from '../../src/config.js';

const SECRET = 'super-secret-brain-key-0123456789abcdef';
const CONFIG: FalsifyConfig = {
  brainRestBase: 'https://brain.example.test',
  brainKey: SECRET,
  project: 'falsify',
};

const MEMORY: BrainMemory = {
  content: 'Energy is conserved in an isolated system.',
  source: 'falsify-knowledge-seed',
  metadata: { tier: 'bedrock', source_id: 'conservation_energy', falsifiable: true },
};

/** A fake session whose callTool always succeeds and records its calls. */
function okSession(): McpSession & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === 'search_thoughts' ? { results: [{ content: 'hit' }] } : {};
    }),
    close: vi.fn(async () => {}),
  };
}

let queueDir: string;

beforeEach(() => {
  queueDir = mkdtempSync(join(tmpdir(), 'falsify-mcp-queue-'));
});

afterEach(() => {
  rmSync(queueDir, { recursive: true, force: true });
});

describe('foldMetadataIntoContent', () => {
  it('appends a readable metadata block to the content', () => {
    const folded = foldMetadataIntoContent(MEMORY);
    expect(folded).toContain('Energy is conserved');
    expect(folded).toContain('— Falsify knowledge seed —');
    expect(folded).toContain('tier: bedrock');
    expect(folded).toContain('source_id: conservation_energy');
    expect(folded).toContain('falsifiable: true');
  });

  it('serializes nested metadata values as JSON', () => {
    const folded = foldMetadataIntoContent({
      content: 'Contested question.',
      metadata: { positions: [{ label: 'A' }, { label: 'B' }] },
    });
    expect(folded).toContain('positions: [{"label":"A"},{"label":"B"}]');
  });

  it('returns the bare content when there is no metadata', () => {
    expect(foldMetadataIntoContent({ content: 'plain' })).toBe('plain');
  });
});

describe('OpenBrainMcpClient.save — success path', () => {
  it('calls capture_thought with folded content, project, and source', async () => {
    const session = okSession();
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: async () => session });

    const result = await client.save(MEMORY);

    expect(result.saved).toBe(true);
    expect(result.queued).toBe(false);
    expect(session.calls).toHaveLength(1);
    const call = session.calls[0]!;
    expect(call.name).toBe('capture_thought');
    expect(call.args.project).toBe('falsify');
    expect(call.args.source).toBe('falsify-knowledge-seed');
    expect(String(call.args.content)).toContain('tier: bedrock');
  });

  it('opens exactly one session across many saves', async () => {
    const session = okSession();
    const connect = vi.fn(async () => session);
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: connect });

    await client.save(MEMORY);
    await client.save({ content: 'another' });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(session.calls).toHaveLength(2);
  });
});

describe('OpenBrainMcpClient.save — offline fallback', () => {
  it('queues to disk when the session cannot be established', async () => {
    const connect: McpConnect = async () => {
      throw new Error('brain unreachable');
    };
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: connect });

    const result = await client.save(MEMORY);

    expect(result.saved).toBe(false);
    expect(result.queued).toBe(true);
    expect(client.pendingCount()).toBe(1);
  });

  it('queues when the tool call fails', async () => {
    const connect: McpConnect = async () => ({
      callTool: async () => {
        throw new Error('tool error');
      },
      close: async () => {},
    });
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: connect });

    const result = await client.save(MEMORY);
    expect(result.queued).toBe(true);
    expect(client.pendingCount()).toBe(1);
  });

  it('retries a transient HTTP 429 with backoff, then succeeds', async () => {
    let attempts = 0;
    const connect: McpConnect = async () => ({
      callTool: async (name: string) => {
        if (name !== 'capture_thought') return {};
        attempts += 1;
        if (attempts < 3) throw new Error('Error POSTing to endpoint (HTTP 429): rate limited');
        return {};
      },
      close: async () => {},
    });
    const client = new OpenBrainMcpClient(CONFIG, {
      queueDir,
      connectImpl: connect,
      maxRetries: 5,
      // Shrink backoff is not exposed; the first two backoffs (1s, 2s) are fine
      // for a single test but we keep the assertion on outcome, not timing.
    });

    const result = await client.save(MEMORY);
    expect(result.saved).toBe(true);
    expect(attempts).toBe(3);
  }, 15000);

  it('gives up after maxRetries on a persistent transient failure', async () => {
    const connect: McpConnect = async () => ({
      callTool: async () => {
        throw new Error('Error POSTing to endpoint (HTTP 503): unavailable');
      },
      close: async () => {},
    });
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: connect, maxRetries: 1 });

    const result = await client.save(MEMORY);
    expect(result.queued).toBe(true);
  }, 15000);

  it('drains the queue on the next successful save', async () => {
    // First save fails and enqueues.
    const offline = new OpenBrainMcpClient(CONFIG, {
      queueDir,
      connectImpl: async () => {
        throw new Error('offline');
      },
    });
    await offline.save(MEMORY);
    expect(offline.pendingCount()).toBe(1);

    // Second client is online — current save + drained backlog = 2 captures.
    const session = okSession();
    const online = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: async () => session });
    const result = await online.save({ content: 'second memory' });

    expect(result.saved).toBe(true);
    expect(result.drained).toBe(1);
    expect(online.pendingCount()).toBe(0);
    expect(session.calls).toHaveLength(2);
  });

  it('never writes the key into a queued payload', async () => {
    const client = new OpenBrainMcpClient(CONFIG, {
      queueDir,
      connectImpl: async () => {
        throw new Error('offline');
      },
    });
    await client.save(MEMORY);

    const files = readdirSync(queueDir);
    expect(files).toHaveLength(1);
    const contents = readFileSync(join(queueDir, files[0]!), 'utf8');
    expect(contents).not.toContain(SECRET);
  });
});

describe('OpenBrainMcpClient.recall', () => {
  it('returns the results array from search_thoughts', async () => {
    const session = okSession();
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: async () => session });

    const hits = await client.recall({ query: 'energy', limit: 5 });

    expect(hits).toHaveLength(1);
    expect(session.calls[0]!.name).toBe('search_thoughts');
    expect(session.calls[0]!.args.query).toBe('energy');
    expect(session.calls[0]!.args.limit).toBe(5);
  });
});

describe('OpenBrainMcpClient.close', () => {
  it('closes an open session and is a no-op when none is open', async () => {
    const session = okSession();
    const client = new OpenBrainMcpClient(CONFIG, { queueDir, connectImpl: async () => session });

    await client.close(); // no session yet — must not throw
    await client.save(MEMORY);
    await client.close();

    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
