/**
 * `falsify_recall` — the MCP adapter for Corpus-tier recall (DESIGN.md §5).
 *
 * All discipline (graceful offline degradation, never leaking the key) lives in
 * {@link opRecall}; this file declares the input schema, passes the injected
 * reader, and maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { opRecall } from '../../cycle/operations.js';
import type { FalsifyServerDeps } from '../deps.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_recall`. */
const inputShape = {
  query: z.string().min(1, 'a search query is required'),
  limit: z.number().int().positive().optional(),
} as const;

/** Register `falsify_recall` on the server. */
export function registerRecall(server: McpServer, deps: FalsifyServerDeps): void {
  server.registerTool(
    'falsify_recall',
    {
      description:
        'Recall prior Falsify knowledge and decisions from the OpenBrain corpus (semantic search). ' +
        'Degrades gracefully: if the brain is offline the cycle tools still work, this just returns an error.',
      inputSchema: inputShape,
    },
    async (args) =>
      toCallToolResult(
        await opRecall(
          { query: args.query, limit: args.limit },
          deps.memory,
        ),
      ),
  );
}
