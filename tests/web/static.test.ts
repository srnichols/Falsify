import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebServer } from '../../src/web/server.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsFiles(full);
    return name.endsWith('.js') ? [full] : [];
  });
}

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

  it('serves the dashboard shell at / with a nav entry for every screen', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Falsify');
    expect(html).toContain('id="view"');
    for (const route of ['dashboard', 'inquiry', 'sessions', 'knowledge', 'tools', 'outcomes', 'notebook']) {
      expect(html, `nav link for ${route}`).toContain(`data-route="${route}"`);
    }
    expect(html).toContain('/app.js');
  });

  it('serves app.js and a nested view module as JavaScript', async () => {
    const booted = await boot();
    server = booted.server;
    for (const path of ['/app.js', '/js/views/dashboard.js']) {
      const res = await fetch(`${booted.base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/javascript');
    }
  });

  it('serves styles.css as CSS and the favicon as SVG', async () => {
    const booted = await boot();
    server = booted.server;
    const css = await fetch(`${booted.base}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const icon = await fetch(`${booted.base}/favicon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toContain('image/svg+xml');
  });

  it('returns 404 for an unknown asset', async () => {
    const booted = await boot();
    server = booted.server;
    const res = await fetch(`${booted.base}/nope.js`);
    expect(res.status).toBe(404);
  });
});

describe('front-end modules', () => {
  const files = jsFiles(publicDir);

  it('every relative import resolves to a file that exists', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:import|export)[^'"]*?from\s+'(\.[^']+)'/g)) {
        expect(existsSync(resolve(dirname(file), match[1] as string)), `${file} imports ${match[1]}`).toBe(true);
      }
    }
  });

  it('never assigns HTML, so server text cannot inject markup', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/);
    }
  });

  it('uses no inline style or script attributes, which the CSP forbids', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/setAttribute\(\s*'style'|\bstyle:\s*['"`]/);
    }
    expect(readFileSync(join(publicDir, 'index.html'), 'utf8')).not.toMatch(/\sstyle=|<script>[^<]/);
  });
});
