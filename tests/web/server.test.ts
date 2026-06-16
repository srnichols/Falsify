import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../../src/web/server.js';
import type { WebDeps } from '../../src/web/api.js';
import { NotebookStore } from '../../src/memory/notebook.js';
import type { MemoryReader } from '../../src/memory/openbrainClient.js';
import type { Server } from 'node:http';

/** Boot a server on an ephemeral localhost port and return its base URL. */
async function boot(deps: WebDeps): Promise<{ base: string; host: string; server: Server }> {
  const server = createWebServer(deps);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${addr.port}`, host: addr.address, server };
}

describe('Falsify web server', () => {
  let dir: string;
  let server: Server;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-server-'));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('binds to 127.0.0.1 and serves a cycle step over real HTTP', async () => {
    const booted = await boot({ notebook: new NotebookStore(dir, 'test') });
    server = booted.server;
    expect(booted.host).toBe('127.0.0.1');

    const res = await fetch(`${booted.base}/api/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Does X lower Y within an hour?' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { cycleState: string };
    expect(json.cycleState).toBe('hypothesis');
  });

  it('refuses a path-traversal request and serves nothing outside public/', async () => {
    const booted = await boot({ notebook: new NotebookStore(dir, 'test') });
    server = booted.server;

    const res = await fetch(`${booted.base}/../package.json`, { redirect: 'manual' });
    expect([403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain('"name": "falsify"');
  });

  it('returns 400 on invalid JSON', async () => {
    const booted = await boot({ notebook: new NotebookStore(dir, 'test') });
    server = booted.server;

    const res = await fetch(`${booted.base}/api/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { rule: string };
    expect(json.rule).toBe('request:invalid-json');
  });

  it('never includes a key-bearing reader error in the HTTP response', async () => {
    const reader: MemoryReader = {
      recall: async () => {
        throw new Error('connect failed x-brain-key=LEAKED_KEY_XYZ');
      },
    };
    const booted = await boot({ notebook: new NotebookStore(dir, 'test'), memory: reader });
    server = booted.server;

    const res = await fetch(`${booted.base}/api/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'anything' }),
    });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain('LEAKED_KEY_XYZ');
  });
});
