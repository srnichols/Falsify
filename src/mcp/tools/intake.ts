/**
 * `falsify_intake` — the gate at the mouth of the cycle (DESIGN.md §3, Intake).
 *
 * It asks Popper's question: *is this claim falsifiable?* The judgment that is
 * genuinely AI-hard stays with the host agent; what lives here is the
 * deterministic, testable part — a checklist that flags the obvious
 * non-scientific shapes (value/normative/definitional phrasing) and, crucially,
 * detects a **consensus appeal** and answers it with the essay's challenge
 * (Phase-2 plan, Decision 6).
 *
 * Consensus is a signal, not a verdict: an appeal to it is met with a demand for
 * the receipts, never with deference.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import type { CycleState } from '../../domain/types.js';
import { ok, withState, advance } from '../result.js';

/** The challenge Falsify returns to any appeal to authority (DESIGN.md §3). */
export const CONSENSUS_CHALLENGE =
  'Which experiment showed that, and could it have come out the other way?';

/** Phrases that signal an appeal to consensus/authority rather than evidence. */
const CONSENSUS_APPEAL_PATTERNS: readonly RegExp[] = [
  /\bthe science is settled\b/i,
  /\bsettled science\b/i,
  /\bscientists agree\b/i,
  /\bexperts agree\b/i,
  /\bscientific consensus\b/i,
  /\beveryone knows\b/i,
  /\bno one (?:seriously )?(?:disputes|doubts)\b/i,
  /\b\d{1,3}\s?% of (?:scientists|experts|doctors)\b/i,
];

/** Phrases that signal a normative / value claim — outside the method. */
const NORMATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:should|ought to|must)\b/i,
  /\b(?:morally|ethically) (?:right|wrong)\b/i,
  /\bis (?:better|worse|best|the best) than?\b/i,
  /\b(?:beautiful|ugly|good|evil|immoral)\b/i,
];

/** Phrases that signal a definitional / tautological claim — unfalsifiable. */
const DEFINITIONAL_PATTERNS: readonly RegExp[] = [/\bby definition\b/i, /\bis defined as\b/i];

function matches(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** The validated input shape for `falsify_intake`. */
const inputShape = {
  question: z.string().min(1, 'a question is required'),
  cycleState: CycleStateSchema.optional(),
} as const;

/**
 * Register `falsify_intake` on the server.
 *
 * Output: `{ falsifiable, reason, consensusAppeal?, challenge?, reframedHint? }`.
 * When the claim is falsifiable, the cycle advances Intake → Hypothesis; when it
 * is not, the result flags it as outside the method and the cycle stays put.
 */
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
    (args) => {
      const question = args.question;
      const state: CycleState = args.cycleState ?? 'intake';

      const consensusAppeal = matches(question, CONSENSUS_APPEAL_PATTERNS);
      const normative = matches(question, NORMATIVE_PATTERNS);
      const definitional = matches(question, DEFINITIONAL_PATTERNS);

      if (normative || definitional) {
        const kind = normative ? 'normative/value' : 'definitional/tautological';
        const base = {
          question,
          falsifiable: false as const,
          reason: `This reads as a ${kind} claim: no conceivable observation could prove it wrong, so it sits outside the scientific method.`,
          reframedHint:
            'Reframe it as an empirical prediction \u2014 state what you would expect to observe, and what observation would prove it wrong.',
        };
        return consensusAppeal
          ? ok({ ...base, consensusAppeal: true, challenge: CONSENSUS_CHALLENGE })
          : ok(base);
      }

      // Falsifiable (as far as the checklist can tell): advance the cycle.
      const moved = advance(state, 'hypothesize');
      if ('error' in moved) {
        return moved.error;
      }

      const payload: Record<string, unknown> = {
        question,
        falsifiable: true,
        reason:
          'No non-scientific red flags detected. Proceed to state a hypothesis with at least one falsification condition.',
      };
      if (consensusAppeal) {
        payload.consensusAppeal = true;
        payload.challenge = CONSENSUS_CHALLENGE;
      }
      return withState(payload, moved.next);
    },
  );
}
