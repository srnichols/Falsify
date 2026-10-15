/**
 * `falsify_dissent` — the MCP adapter for dissent over consensus (DESIGN.md §6).
 *
 * All logic lives in {@link opDissent}; this file declares the input schema and
 * maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { opDissent } from '../../cycle/dissent.js';
import type { CycleContext } from '../../cycle/context.js';
import { EvidenceSchema } from '../../domain/evidence.js';
import { toCallToolResult } from '../result.js';

/** One competing position, as accepted by both the MCP tool and the web API. */
export const DissentPositionSchema = z.object({
  label: z.string().min(1),
  source: z.string().optional(),
  statement: z.string().min(1),
  predicts: z.string().min(1),
  falsificationConditions: z.array(z.object({ description: z.string(), observable: z.boolean().optional() })).optional(),
  evidence: z.array(EvidenceSchema).optional(),
  outcome: z
    .object({ variable: z.string().min(1), direction: z.enum(['increase', 'decrease', 'no-change']) })
    .optional(),
});

const inputShape = {
  question: z.string().optional(),
  positions: z.array(DissentPositionSchema).min(2, 'dissent needs at least two competing positions'),
} as const;

/** Register `falsify_dissent` on the server. */
export function registerDissent(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_dissent',
    {
      description:
        'Compare competing hypotheses (for example, one from each of several models) and surface ' +
        'where they disagree instead of burying it. Each position must pass the same honesty rules ' +
        'as falsify_hypothesize. Returns pairwise agreement, the falsifiers unique to each position ' +
        'and the tests that would discriminate between them. Give each position an `outcome` ' +
        '({variable, direction: increase|decrease|no-change}) so agreement is judged from what is ' +
        'predicted rather than guessed from wording. Also returns any Contested entry the question ' +
        'matches. It never picks a winner, and warns when positions agree, because several models ' +
        'agreeing is a consensus signal, not an experiment. Falsify does not call models: gather the ' +
        'positions yourself and submit them here.',
      inputSchema: inputShape,
    },
    (args) => toCallToolResult(opDissent({ question: args.question, positions: args.positions }, ctx)),
  );
}
