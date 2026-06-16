#!/usr/bin/env node
/**
 * The Falsify web server — a thin `node:http` shell over {@link handleRequest}
 * and a static file server for the front-end (Phase-3 plan, Slice 3).
 *
 * It imports no framework: zero new runtime dependencies. The server binds to
 * localhost by default (a single-user local tool), caps the request body, and
 * serves static assets only from `public/` with a path-traversal guard. Importing
 * this module never starts listening — the `main()` at the bottom is entry-guarded
 * so it only runs when the file is executed directly.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { handleRequest } from './api.js';
import type { WebDeps } from './api.js';

/** Default localhost bind host. */
const DEFAULT_HOST = '127.0.0.1';
/** Default port; overridable via `FALSIFY_WEB_PORT`. */
const DEFAULT_PORT = 4319;
/** Maximum accepted request body, in bytes. */
const MAX_BODY_BYTES = 1_000_000;

/** Where static front-end assets are served from. */
const PUBLIC_DIR = resolve(process.cwd(), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  const body = JSON.stringify(json);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = resolve(PUBLIC_DIR, rel);
  // Path-traversal guard: the resolved file must stay inside PUBLIC_DIR.
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) {
    sendJson(res, 404, { error: 'Not found.', rule: 'request:not-found', guidance: 'No such asset.' });
    return;
  }
  try {
    const data = await readFile(full);
    const type = CONTENT_TYPES[extname(full)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found.', rule: 'request:not-found', guidance: 'No such asset.' });
  }
}

/**
 * Build the Falsify web server. Does not listen — the caller (or `main`) calls
 * `.listen(...)`. Dependencies are injected for testability.
 */
export function createWebServer(deps: WebDeps = {}): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleConnection(req, res, deps);
  });
}

async function handleConnection(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebDeps,
): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  // Static assets: anything that is not an /api route is served from public/.
  if (!pathname.startsWith('/api')) {
    if (method !== 'GET') {
      sendJson(res, 404, { error: 'Not found.', rule: 'request:not-found', guidance: 'Use GET for assets.' });
      return;
    }
    await serveStatic(pathname, res);
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw.trim() === '' ? undefined : JSON.parse(raw);
  } catch (err) {
    if (err && typeof err === 'object' && 'tooLarge' in err) {
      sendJson(res, 413, {
        error: 'Request body too large.',
        rule: 'request:body-too-large',
        guidance: `Keep the request body under ${MAX_BODY_BYTES} bytes.`,
      });
      return;
    }
    sendJson(res, 400, {
      error: 'Request body must be valid JSON.',
      rule: 'request:invalid-json',
      guidance: 'Send a JSON object as the request body.',
    });
    return;
  }

  const result = await handleRequest(method, pathname, body, deps);
  sendJson(res, result.status, result.json);
}

/** Start the server over HTTP. Only invoked when this module is the entrypoint. */
function main(): void {
  const port = Number(process.env.FALSIFY_WEB_PORT ?? DEFAULT_PORT);
  const host = DEFAULT_HOST;
  const server = createWebServer();
  server.listen(port, host, () => {
    console.error(`Falsify web UI listening on http://${host}:${port}`);
  });
}

// Entry-point guard: run the transport only when executed directly, never on import.
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
