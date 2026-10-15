/**
 * `falsify_related` — the MCP adapter for knowledge lookup (DESIGN.md §4).
 *
 * All logic lives in {@link opRelated}; this file declares the input schema and
 * maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { opRelated } from '../../cycle/related.js';
import type { CycleContext } from '../../cycle/context.js';
import { toCallToolResult } from '../result.js';

const inputShape = {
  claim: z.string().min(1, 'a claim is required'),
  limit: z.number().int().positive().max(20).optional(),
} as const;

/** Register `falsify_related` on the server. */
export function registerRelated(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_related',
    {
      description:
        'Find the knowledge tiers a claim touches before you commit to a hypothesis: refuted ' +
        'lookalikes, Bedrock/Established laws (with the burden of proof), and Contested questions ' +
        '(with every position). Matches by wording, plus semantic recall from the corpus when ' +
        'OPENBRAIN_KEY is set, so paraphrases are found too. Absence of a match is not absence of ' +
        'relevant knowledge.',
      inputSchema: inputShape,
    },
    async (args) => toCallToolResult(await opRelated({ claim: args.claim, limit: args.limit }, ctx)),
  );
}
