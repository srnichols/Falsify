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
import { toCallToolResult } from '../result.js';

/** Re-exported for callers/tests that assert the consensus challenge text. */
export { CONSENSUS_CHALLENGE };

/** The validated input shape for `falsify_intake`. */
const inputShape = {
  question: z.string().min(1, 'a question is required'),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_intake` on the server. */
export function registerIntake(server: McpServer): void {
  server.registerTool(
    'falsify_intake',
    {
      description:
        'Decide whether a question is falsifiable (Popper\u2019s line). Flags normative, ' +
        'definitional, or consensus-appeal phrasings. A consensus appeal is answered with a ' +
        'demand for the experiment, never deference. On a falsifiable claim the cycle advances ' +
        'to Hypothesis; otherwise it is flagged as outside the scientific method.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(opIntake({ question: args.question, cycleState: args.cycleState })),
  );
}
