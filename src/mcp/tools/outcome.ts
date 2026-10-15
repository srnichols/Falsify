/**
 * `falsify_outcome` — the MCP adapter for recording what later happened to a theory.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { opOutcome } from '../../cycle/outcome.js';
import type { CycleContext } from '../../cycle/context.js';
import { toCallToolResult } from '../result.js';

const inputShape = {
  sessionId: z.string().min(1),
  outcome: z.enum(['held-up', 'refuted', 'inconclusive']),
  basis: z.string(),
  reference: z.string().optional(),
} as const;

/** Register `falsify_outcome` on the server. */
export function registerOutcome(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_outcome',
    {
      description:
        'Record what later happened to a theory that completed the cycle: held-up (a replication or ' +
        'further test supported it), refuted (it failed a later test), or inconclusive. Give a basis ' +
        '(what happened and how you know) and a reference (DOI or URL) if there is one. The score the ' +
        'theory was confirmed with is kept alongside, so over time the score can be checked against ' +
        'real outcomes. An outcome can be superseded; the earlier one is kept.',
      inputSchema: inputShape,
    },
    async (args) =>
      toCallToolResult(
        opOutcome({ sessionId: args.sessionId, outcome: args.outcome, basis: args.basis, reference: args.reference }, ctx),
      ),
  );
}
