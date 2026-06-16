/**
 * `falsify_experiment` — the MCP adapter for the Experiment step (DESIGN.md §3).
 *
 * All discipline lives in {@link opExperiment}; this file declares the input
 * schema and maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opExperiment } from '../../cycle/operations.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_experiment`. */
const inputShape = {
  decisiveEvidence: z.array(z.string()).optional(),
  couldFail: z.boolean(),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_experiment` on the server. */
export function registerExperiment(server: McpServer): void {
  server.registerTool(
    'falsify_experiment',
    {
      description:
        'Design the decisive test: what evidence would settle the hypothesis, stated so it COULD ' +
        'fail. An experiment that cannot come out the other way is rejected. Advances the cycle to ' +
        'Analysis.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(
        opExperiment({
          decisiveEvidence: args.decisiveEvidence,
          couldFail: args.couldFail,
          cycleState: args.cycleState,
        }),
      ),
  );
}
