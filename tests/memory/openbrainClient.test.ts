import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenBrainClient,
  type FetchLike,
  type BrainMemory,
} from '../../src/memory/openbrainClient.js';
import type { FalsifyConfig } from '../../src/config.js';

const SECRET = 'super-secret-brain-key-0123456789abcdef';
const CONFIG: FalsifyConfig = {
  brainRestBase: 'https://brain.example.test',
  brainKey: SECRET,
  project: 'falsify',
};

const MEMORY: BrainMemory = { content: 'A hypothesis survived its test.', source: 'cycle' };

function okFetch(): FetchLike {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'm1' }) }));
}

function failFetch(): FetchLike {
  return vi.fn(async () => {
    throw new Error('network down');
  });
}

let queueDir: string;

beforeEach(() => {
  queueDir = mkdtempSync(join(tmpdir(), 'falsify-queue-'));
});

afterEach(() => {
  rmSync(queueDir, { recursive: true, force: true });
});

describe('OpenBrainClient.save — success path', () => {
  it('posts to /memories with the key header and project in the body', async () => {
    const fetchImpl = okFetch();
    const client = new OpenBrainClient(CONFIG, { queueDir, fetchImpl });

    const result = await client.save(MEMORY);

    expect(result.saved).toBe(true);
    expect(result.queued).toBe(false);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [url, init] = calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://brain.example.test/memories');
    expect(init.headers['x-brain-key']).toBe(SECRET);
    expect(JSON.parse(init.body)).toMatchObject({ content: MEMORY.content, project: 'falsify' });
  });
});

describe('OpenBrainClient.save — offline fallback', () => {
  it('queues to disk when the brain is unreachable', async () => {
    const client = new OpenBrainClient(CONFIG, { queueDir, fetchImpl: failFetch() });

    const result = await client.save(MEMORY);

    expect(result.saved).toBe(false);
    expect(result.queued).toBe(true);
    expect(client.pendingCount()).toBe(1);
    expect(existsSync(queueDir)).toBe(true);
  });

  it('drains the queue on the next successful save', async () => {
    // First save fails and enqueues.
    const offline = new OpenBrainClient(CONFIG, { queueDir, fetchImpl: failFetch() });
    await offline.save(MEMORY);
    expect(offline.pendingCount()).toBe(1);

    // Second save succeeds and drains the backlog (queued + current = 2 posts).
    const fetchImpl = okFetch();
    const online = new OpenBrainClient(CONFIG, { queueDir, fetchImpl });
    const result = await online.save({ content: 'second memory' });

    expect(result.saved).toBe(true);
    expect(result.drained).toBe(1);
    expect(online.pendingCount()).toBe(0);
    const callCount = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBe(2); // current save + one drained item
  });
});

describe('OpenBrainClient — the key never leaks', () => {
  it('does not include the key in an HTTP error', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const client = new OpenBrainClient(CONFIG, { queueDir, fetchImpl });

    // A 401 on recall should throw, but the message must not contain the secret.
    await expect(client.recall({ query: 'x' })).rejects.toThrow();
    try {
      await client.recall({ query: 'x' });
    } catch (err) {
      expect(String(err)).not.toContain(SECRET);
      expect((err as Error).message).not.toContain(SECRET);
    }
  });

  it('does not write the key into the offline queue payload', async () => {
    const client = new OpenBrainClient(CONFIG, { queueDir, fetchImpl: failFetch() });
    await client.save(MEMORY);

    const fs = await import('node:fs');
    const files = fs.readdirSync(queueDir);
    expect(files.length).toBe(1);
    const contents = fs.readFileSync(join(queueDir, files[0]!), 'utf8');
    expect(contents).not.toContain(SECRET);
  });
});

describe('OpenBrainClient.recall', () => {
  it('returns the results array from the response', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ content: 'hit', similarity: 0.9 }] }),
    }));
    const client = new OpenBrainClient(CONFIG, { queueDir, fetchImpl });

    const hits = await client.recall({ query: 'entropy', limit: 5 });
    expect(hits).toHaveLength(1);
  });
});
