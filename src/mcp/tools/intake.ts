/**
 * `falsify_intake` — the MCP adapter for the Intake gate (DESIGN.md §3).
 *
 * All discipline lives in {@link opIntake}; this file only declares the tool's
 * input schema and maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opIntake, CONSENSUS_CHALLENGE } from '../../cycle/operations.js';
import { adviseIntake } from '../../cycle/advice.js';
import type { CycleContext } from '../../cycle/context.js';
import { toCallToolResult } from '../result.js';

/** Re-exported for callers/tests that assert the consensus challenge text. */
export { CONSENSUS_CHALLENGE };

/** The validated input shape for `falsify_intake`. */
const inputShape = {
  question: z.string().min(1, 'a question is required'),
  cycleState: CycleStateSchema.optional(),
  mirrorOf: z.string().min(1).optional(),
} as const;

/** Register `falsify_intake` on the server. */
export function registerIntake(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_intake',
    {
      description:
        'Decide whether a question is falsifiable (Popper\u2019s line). Flags normative, ' +
        'definitional, or consensus-appeal phrasings. A consensus appeal is answered with a ' +
        'demand for the experiment, never deference. On a falsifiable claim the cycle advances ' +
        'to Hypothesis and a sessionId is returned: pass it to every later falsify_* call so the ' +
        'cycle is tracked and enforced server-side. Otherwise the question is flagged as outside ' +
        'the scientific method. To test the opposite framing of a question (the other side of it), ' +
        'start a second inquiry with mirrorOf set to the first sessionId: the two are linked, compared ' +
        'at Review for uneven rigor, and a theory with no completed opposite framing cannot be rated ' +
        '"supported".',
      inputSchema: inputShape,
    },
    async (args) =>
      toCallToolResult(
        await adviseIntake(
          args.question,
          opIntake({ question: args.question, cycleState: args.cycleState, mirrorOf: args.mirrorOf }, ctx),
          ctx,
        ),
      ),
  );
}
