/**
 * `falsify_analyze` — compare the data to the prediction (DESIGN.md §3, Analysis).
 *
 * The verdict is a plain Yes or No, and the **No branch is not optional**: a
 * 'no' routes the cycle to Review. Critically, a 'yes' is NOT finalized here —
 * DESIGN.md §3 makes the Review step mandatory even on a Yes ("cheap insurance
 * against fooling ourselves"). So a 'yes' stays in Analysis and returns
 * `reviewRequired: true`; only `falsify_review` with `outcome: 'confirm'` may then
 * advance to Theory (Phase-2 plan, Decision 5).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema, AnalysisSchema } from '../../domain/schemas.js';
import type { CycleState } from '../../domain/types.js';
import { legalEvents } from '../../cycle/stateMachine.js';
import { fail, ok, withState, advance } from '../result.js';

/** The validated input shape for `falsify_analyze`. */
const inputShape = {
  verdict: z.enum(['yes', 'no']),
  evidenceCited: z.array(z.string()).optional(),
  cycleState: CycleStateSchema.optional(),
} as const;

/**
 * Register `falsify_analyze` on the server.
 *
 * - `verdict: 'no'` → cycle advances Analysis → Review (take the No branch).
 * - `verdict: 'yes'` → cycle stays in Analysis with `reviewRequired: true`; the
 *   caller must run `falsify_review` with `outcome: 'confirm'` to reach Theory.
 */
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
    (args) => {
      const state: CycleState = args.cycleState ?? 'analysis';

      const parsed = AnalysisSchema.safeParse({
        verdict: args.verdict,
        evidenceCited: args.evidenceCited ?? [],
      });
      if (!parsed.success) {
        return fail(
          'An analysis must cite the evidence its verdict rests on.',
          'analysis:evidence-required',
          'List the observation(s) the verdict is based on in evidenceCited.',
        );
      }

      if (parsed.data.verdict === 'no') {
        const moved = advance(state, 'refute');
        if ('error' in moved) {
          return moved.error;
        }
        return withState({ analysis: parsed.data }, moved.next);
      }

      // verdict === 'yes' — do NOT finalize; Review is mandatory (DESIGN.md §3).
      if (!legalEvents(state).includes('confirm')) {
        return fail(
          `A 'yes' verdict is only meaningful from the Analysis state (got '${state}').`,
          'cycle:illegal-transition',
          'Run falsify_analyze from the analysis state reached after falsify_experiment.',
        );
      }
      return ok({
        analysis: parsed.data,
        reviewRequired: true,
        nextTool: 'falsify_review',
        cycleState: state,
        legalNext: legalEvents(state),
        note: 'Yes is not final: run falsify_review (outcome: confirm) to record a Theory.',
      });
    },
  );
}
