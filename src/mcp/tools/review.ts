/**
 * `falsify_review` — the MCP adapter for the mandatory Review checkpoint
 * (DESIGN.md §3).
 *
 * All discipline lives in {@link opReview}; this file declares the input schema
 * and maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opReview } from '../../cycle/operations.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_review`. */
const inputShape = {
  q1Methods: z.string(),
  q2Hypothesis: z.string(),
  q3Theory: z.string(),
  outcome: z.enum(['revise', 'confirm']),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_review` on the server. */
export function registerReview(server: McpServer): void {
  server.registerTool(
    'falsify_review',
    {
      description:
        'The mandatory review checkpoint. Answer three questions IN ORDER \u2014 1) were the methods ' +
        'sound? 2) was the hypothesis wrong? 3) is the underlying theory wrong? Use outcome "revise" ' +
        'to loop back to Hypothesis (the No branch), or outcome "confirm" (only after a yes verdict) ' +
        'to finalize a Theory.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(
        opReview({
          q1Methods: args.q1Methods,
          q2Hypothesis: args.q2Hypothesis,
          q3Theory: args.q3Theory,
          outcome: args.outcome,
          cycleState: args.cycleState,
        }),
      ),
  );
}
