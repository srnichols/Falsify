/**
 * `falsify_hypothesize` — the MCP adapter for the Hypothesis step (DESIGN.md §3).
 *
 * All discipline lives in {@link opHypothesize}; this file declares the input
 * schema, threads the injected quant principles, and maps the neutral result.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opHypothesize } from '../../cycle/operations.js';
import type { CycleContext } from '../../cycle/context.js';
import type { FalsifyServerDeps } from '../deps.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_hypothesize`. */
const inputShape = {
  statement: z.string().min(1, 'a hypothesis statement is required'),
  predicts: z.string().min(1, 'state what the hypothesis predicts'),
  falsificationConditions: z
    .array(
      z.object({
        description: z.string(),
        observable: z.boolean().optional(),
      }),
    )
    .optional(),
  claimType: z.enum(['universal', 'existential', 'probabilistic', 'causal']).optional(),
  assumptions: z.array(z.string()).optional(),
  revisionNote: z.string().optional(),
  sessionId: z.string().optional(),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_hypothesize` on the server. */
export function registerHypothesize(server: McpServer, deps: FalsifyServerDeps, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_hypothesize',
    {
      description:
        'Turn a candidate claim into a testable hypothesis. REQUIRES at least one falsification ' +
        'condition \u2014 a described observation that would prove the hypothesis wrong, not just "if ' +
        'it is wrong" \u2014 or the claim is rejected. Returns the knowledge tiers the claim touches ' +
        '(Bedrock/Established burden of proof, Contested positions, refuted lookalikes), applies the ' +
        'quantitative lens, and locks the prediction before any analysis. After a refutation, ' +
        'pass revisionNote and keep every earlier falsifier. Optional claimType: universal, ' +
        'existential, probabilistic (needs a numeric threshold), causal (needs a comparison). ' +
        'Pass the sessionId from falsify_intake. Advances the cycle to Experiment.',
      inputSchema: inputShape,
    },
    (args) =>
      toCallToolResult(
        opHypothesize(
          {
            statement: args.statement,
            predicts: args.predicts,
            falsificationConditions: args.falsificationConditions,
            claimType: args.claimType,
            assumptions: args.assumptions,
            revisionNote: args.revisionNote,
            sessionId: args.sessionId,
            cycleState: args.cycleState,
          },
          deps.quantPrinciples,
          ctx,
        ),
      ),
  );
}
