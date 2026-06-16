/**
 * `falsify_experiment` — design the decisive test (DESIGN.md §3, Experiment).
 *
 * The one non-negotiable: the experiment must be able to FAIL. An experiment that
 * cannot come out the other way proves nothing, so `couldFail` is a literal
 * `true` in {@link ExperimentSchema} and anything else is refused with a named
 * rule (Phase-2 plan, Slice 3). On success the cycle advances to Analysis.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema, ExperimentSchema } from '../../domain/schemas.js';
import type { CycleState } from '../../domain/types.js';
import { fail, withState, advance } from '../result.js';

/** The validated input shape for `falsify_experiment`. */
const inputShape = {
  decisiveEvidence: z.array(z.string()).optional(),
  couldFail: z.boolean(),
  cycleState: CycleStateSchema.optional(),
} as const;

/**
 * Register `falsify_experiment` on the server.
 *
 * Output on success: `{ experiment, cycleState, legalNext }` with the cycle
 * advanced Experiment → Analysis. Refuses a test that cannot fail
 * (`honesty:experiment-must-be-able-to-fail`) or one with no decisive evidence
 * (`honesty:experiment-needs-decisive-evidence`).
 */
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
    (args) => {
      const state: CycleState = args.cycleState ?? 'experiment';

      if (args.couldFail !== true) {
        return fail(
          'An experiment that cannot fail proves nothing.',
          'honesty:experiment-must-be-able-to-fail',
          'Set couldFail to true only if there is a real observation that would refute the hypothesis; otherwise redesign the test.',
        );
      }

      const parsed = ExperimentSchema.safeParse({
        decisiveEvidence: args.decisiveEvidence ?? [],
        couldFail: args.couldFail,
      });
      if (!parsed.success) {
        return fail(
          'An experiment must name at least one piece of decisive evidence.',
          'honesty:experiment-needs-decisive-evidence',
          'List the observation(s) that would decide the hypothesis in decisiveEvidence.',
        );
      }

      const moved = advance(state, 'analyze');
      if ('error' in moved) {
        return moved.error;
      }

      return withState({ experiment: parsed.data }, moved.next);
    },
  );
}
