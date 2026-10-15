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
import type { CycleContext } from '../../cycle/context.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_review`. */
const inputShape = {
  q1Methods: z.string(),
  q2Hypothesis: z.string(),
  q3Theory: z.string(),
  outcome: z.enum(['revise', 'confirm']),
  acceptTentative: z.boolean().optional(),
  sessionId: z.string().optional(),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_review` on the server. */
export function registerReview(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_review',
    {
      description:
        'The mandatory review checkpoint. Answer three questions IN ORDER \u2014 1) were the methods ' +
        'sound? 2) was the hypothesis wrong? 3) is the underlying theory wrong? Each needs a real ' +
        'answer, not a placeholder. Use outcome "revise" to loop back to Hypothesis (the No branch; the ' +
        'refuted hypothesis is struck through in the notebook), or outcome "confirm" to finalize a ' +
        'Theory \u2014 which, with a sessionId, requires a recorded yes verdict and is then recorded with ' +
        'an epistemicStatus (supported, provisional or tentative). Evidence rated "weak" is refused unless ' +
        'you pass acceptTentative. Completing the cycle records that the process was followed; it does ' +
        'not prove the claim.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(
        opReview(
          {
            q1Methods: args.q1Methods,
            q2Hypothesis: args.q2Hypothesis,
            q3Theory: args.q3Theory,
            outcome: args.outcome,
            acceptTentative: args.acceptTentative,
            sessionId: args.sessionId,
            cycleState: args.cycleState,
          },
          ctx,
        ),
      ),
  );
}
