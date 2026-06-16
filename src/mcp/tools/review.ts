/**
 * `falsify_review` — the mandatory No-branch checkpoint (DESIGN.md §3, Review).
 *
 * When Analysis says No, the cycle does not quietly retry: it asks three
 * questions, in order — were the methods sound? was the hypothesis wrong? is the
 * underlying theory wrong? — then loops back to Hypothesis with what it learned.
 * Review is also mandatory even on a Yes (DESIGN.md §3), so this tool is the only
 * place a Theory can be finalized: `outcome: 'confirm'` advances Analysis → Theory.
 *
 * All three answers are required and non-empty — a review you skip is no review
 * at all (Phase-2 plan, Slice 4).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import type { CycleState } from '../../domain/types.js';
import { fail, withState, advance } from '../result.js';

/** The validated input shape for `falsify_review`. */
const inputShape = {
  q1Methods: z.string(),
  q2Hypothesis: z.string(),
  q3Theory: z.string(),
  outcome: z.enum(['revise', 'confirm']),
  cycleState: CycleStateSchema.optional(),
} as const;

/**
 * Register `falsify_review` on the server.
 *
 * - `outcome: 'revise'` (from the No branch, state Review) → loops back to Hypothesis.
 * - `outcome: 'confirm'` (after a Yes that required review, state Analysis) → finalizes Theory.
 */
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
    (args) => {
      const outcome = args.outcome;
      const state: CycleState = args.cycleState ?? (outcome === 'confirm' ? 'analysis' : 'review');

      const answers = [args.q1Methods, args.q2Hypothesis, args.q3Theory];
      if (answers.some((a) => a.trim().length === 0)) {
        return fail(
          'All three review questions must be answered, in order.',
          'review:three-questions-required',
          'Provide non-empty q1Methods, q2Hypothesis, and q3Theory before revising or confirming.',
        );
      }

      const event = outcome === 'confirm' ? 'confirm' : 'revise';
      const moved = advance(state, event);
      if ('error' in moved) {
        return moved.error;
      }

      return withState(
        {
          review: {
            q1Methods: args.q1Methods,
            q2Hypothesis: args.q2Hypothesis,
            q3Theory: args.q3Theory,
          },
          outcome,
        },
        moved.next,
      );
    },
  );
}
