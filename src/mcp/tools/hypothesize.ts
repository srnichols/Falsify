/**
 * `falsify_hypothesize` — turn a candidate claim into a disciplined hypothesis
 * (DESIGN.md §3, Hypothesis).
 *
 * This is where Falsify's core honesty rule bites: a hypothesis with zero
 * falsification conditions does not parse, so the tool **refuses** it with a
 * named rule rather than coercing it through (Phase-2 plan, Slice 2). The input
 * schema is deliberately permissive about the conditions so the rejection is the
 * structured `honesty:*` failure the host can learn from — not a generic
 * transport validation error.
 *
 * Every accepted hypothesis is then run through the cross-cutting quantitative
 * lens (DESIGN.md §4) before the cycle advances to Experiment.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema, HypothesisSchema } from '../../domain/schemas.js';
import type { CycleState, QuantEntry } from '../../domain/types.js';
import { applyQuantitativeLens } from '../../rules/quantitative.js';
import { loadAllKnowledge } from '../../knowledge/loader.js';
import type { FalsifyServerDeps } from '../deps.js';
import { fail, withState, advance } from '../result.js';

/** Lazily-loaded, memoized default quantitative principles (from the seed). */
let cachedPrinciples: QuantEntry[] | undefined;
function getDefaultQuantPrinciples(): QuantEntry[] {
  if (cachedPrinciples === undefined) {
    const knowledge = loadAllKnowledge();
    cachedPrinciples = knowledge.quantitative.entries as QuantEntry[];
  }
  return cachedPrinciples;
}

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
  cycleState: CycleStateSchema.optional(),
} as const;

/**
 * Register `falsify_hypothesize` on the server.
 *
 * Output on success: `{ hypothesis, quantFlags, cycleState, legalNext }`, with the
 * cycle advanced Hypothesis → Experiment. On a missing/empty falsification
 * condition: a structured `honesty:falsification-condition-required` failure.
 */
export function registerHypothesize(server: McpServer, deps: FalsifyServerDeps): void {
  server.registerTool(
    'falsify_hypothesize',
    {
      description:
        'Turn a candidate claim into a testable hypothesis. REQUIRES at least one falsification ' +
        'condition \u2014 an observation that would prove the hypothesis wrong \u2014 or the claim is ' +
        'rejected. Applies the quantitative lens (base rates, probability) and advances the cycle ' +
        'to Experiment.',
      inputSchema: inputShape,
    },
    (args) => {
      const state: CycleState = args.cycleState ?? 'hypothesis';

      const parsed = HypothesisSchema.safeParse({
        statement: args.statement,
        predicts: args.predicts,
        falsificationConditions: args.falsificationConditions ?? [],
      });
      if (!parsed.success) {
        return fail(
          'A hypothesis must state at least one observation that would prove it wrong.',
          'honesty:falsification-condition-required',
          'Add a non-empty falsificationConditions entry describing what you would observe if the hypothesis were false.',
        );
      }

      const principles = deps.quantPrinciples ?? getDefaultQuantPrinciples();
      const quantFlags = applyQuantitativeLens(
        `${parsed.data.statement} ${parsed.data.predicts}`,
        principles,
      );

      const moved = advance(state, 'experiment');
      if ('error' in moved) {
        return moved.error;
      }

      return withState({ hypothesis: parsed.data, quantFlags }, moved.next);
    },
  );
}
