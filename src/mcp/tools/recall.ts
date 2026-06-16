/**
 * `falsify_recall` — semantic recall from the Corpus tier (DESIGN.md §5).
 *
 * This is the one tool that reaches outside the process, to OpenBrain over MCP
 * (`search_thoughts`). It degrades gracefully: if the brain is unreachable or
 * unconfigured, it returns a structured `recall:brain-unreachable` failure rather
 * than crashing the server — the reasoning tools keep working without it. The
 * `OPENBRAIN_KEY` is read only from the environment and never appears in any
 * result, even on error (Phase-2 plan, Slice 5, Forbidden actions).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from '../../config.js';
import { OpenBrainMcpClient } from '../../memory/openbrainMcpClient.js';
import type { RecallQuery } from '../../memory/openbrainClient.js';
import type { FalsifyServerDeps, MemoryReader } from '../deps.js';
import { ok, fail } from '../result.js';

/** Lazily-constructed, memoized live reader (only built if actually used). */
let cachedReader: MemoryReader | undefined;
function getDefaultReader(): MemoryReader {
  if (cachedReader === undefined) {
    cachedReader = new OpenBrainMcpClient(loadConfig());
  }
  return cachedReader;
}

/** The validated input shape for `falsify_recall`. */
const inputShape = {
  query: z.string().min(1, 'a search query is required'),
  limit: z.number().int().positive().optional(),
} as const;

/**
 * Register `falsify_recall` on the server. Returns `{ query, results, count }` on
 * success; a structured `recall:brain-unreachable` failure when the brain is
 * offline or unconfigured. Never leaks the key.
 */
export function registerRecall(server: McpServer, deps: FalsifyServerDeps): void {
  server.registerTool(
    'falsify_recall',
    {
      description:
        'Recall prior Falsify knowledge and decisions from the OpenBrain corpus (semantic search). ' +
        'Degrades gracefully: if the brain is offline the cycle tools still work, this just returns an error.',
      inputSchema: inputShape,
    },
    async (args) => {
      let reader: MemoryReader;
      try {
        reader = deps.memory ?? getDefaultReader();
      } catch {
        return fail(
          'The memory backend is not configured.',
          'recall:brain-unreachable',
          'Set OPENBRAIN_KEY (and optionally OPENBRAIN_REST_BASE) to enable recall.',
        );
      }

      const query: RecallQuery = {
        query: args.query,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      };

      try {
        const results = await reader.recall(query);
        return ok({ query: args.query, results, count: results.length });
      } catch {
        return fail(
          'Could not reach the memory backend.',
          'recall:brain-unreachable',
          'The brain may be offline; recall is unavailable but the reasoning tools still work.',
        );
      }
    },
  );
}
