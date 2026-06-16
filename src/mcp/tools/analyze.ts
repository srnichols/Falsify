/**
 * `falsify_analyze` — the MCP adapter for the Analysis step (DESIGN.md §3).
 *
 * All discipline lives in {@link opAnalyze} — including the mandatory
 * review-on-Yes rule; this file declares the input schema and maps the result.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opAnalyze } from '../../cycle/operations.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_analyze`. */
const inputShape = {
  verdict: z.enum(['yes', 'no']),
  evidenceCited: z.array(z.string()).optional(),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_analyze` on the server. */
export function registerAnalyze(server: McpServer): void {
  server.registerTool(
    'falsify_analyze',
    {
      description:
        'Compare the data to the prediction: verdict yes or no. A "no" takes the mandatory No ' +
        'branch to Review. A "yes" is NOT final \u2014 Review is mandatory even on a yes, so the result ' +
        'reports reviewRequired and you must call falsify_review (outcome: confirm) to finalize a Theory.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(
        opAnalyze({
          verdict: args.verdict,
          evidenceCited: args.evidenceCited,
          cycleState: args.cycleState,
        }),
      ),
  );
}
