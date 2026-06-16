import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createWebServer } from '../../src/web/server.js';

/**
 * The static front-end is served from the real `public/` directory at the repo
 * root (the server resolves it from `process.cwd()`), so these tests assert the
 * actual shipped assets are reachable with the right content types.
 */
async function boot(): Promise<{ base: string; server: Server }> {
  const server = createWebServer({});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${addr.port}`, server };
}

describe('static front-end', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves index.html with the hypothesis card markup at /', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('id="card"');
    expect(html).toContain('Falsify');
    expect(html).toContain('Notebook');
  });

  it('serves app.js as JavaScript', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  it('serves styles.css as CSS', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('returns 404 for an unknown asset', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/nope.js`);
    expect(res.status).toBe(404);
  });
});
