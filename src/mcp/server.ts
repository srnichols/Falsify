#!/usr/bin/env node
/**
 * The Falsify MCP server — a thin transport shell over the transport-free core.
 *
 * `createFalsifyServer` wires the core's discipline into MCP tools; it imports no
 * transport, so importing this module never opens a socket or stdio. The stdio
 * `main()` at the bottom is guarded by an entry-point check, so the server only
 * starts listening when this file is run directly (Phase-2 plan, Slice 1).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from '../index.js';
import type { FalsifyServerDeps } from './deps.js';
import { registerIntake } from './tools/intake.js';
import { registerHypothesize } from './tools/hypothesize.js';
import { registerExperiment } from './tools/experiment.js';
import { registerAnalyze } from './tools/analyze.js';
import { registerReview } from './tools/review.js';
import { registerRecall } from './tools/recall.js';
import { registerRelated } from './tools/related.js';
import { registerDissent } from './tools/dissent.js';
import { SessionStore } from '../cycle/session.js';
import type { CycleContext } from '../cycle/context.js';
import { createDefaultContext } from '../cycle/defaultContext.js';

/**
 * Build a configured Falsify MCP server with all `falsify_*` tools registered.
 * Dependencies (memory, knowledge lens) are injected for testability and default
 * to live resources only when actually used. Sessions default to an in-memory
 * store so cycle state is always server-authoritative.
 */
export function createFalsifyServer(deps: FalsifyServerDeps = {}): McpServer {
  const server = new McpServer({ name: 'falsify', version: VERSION });
  const ctx: CycleContext = { ...deps, sessions: deps.sessions ?? new SessionStore() };

  registerIntake(server, ctx);
  registerHypothesize(server, deps, ctx);
  registerExperiment(server, ctx);
  registerAnalyze(server, ctx);
  registerReview(server, ctx);
  registerRecall(server, deps);
  registerRelated(server, ctx);
  registerDissent(server, ctx);

  return server;
}

/** Start the server over stdio. Only invoked when this module is the entrypoint. */
async function main(): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = createFalsifyServer(createDefaultContext());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Entry-point guard: run the transport only when executed directly, never on import.
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main().catch((err: unknown) => {
    console.error('falsify-mcp failed to start:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
