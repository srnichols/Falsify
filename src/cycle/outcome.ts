/**
 * `falsify_outcome` — record what later happened to a confirmed theory.
 *
 * A theory is only ever "provisionally held". This lets the caller come back when
 * a replication, a failed prediction or new data settles (or fails to settle) it,
 * so the recorded score can eventually be checked against reality.
 */

import { z } from 'zod';
import type { CycleContext } from './context.js';
import { errorResult, okResult } from './operations.js';
import type { OpResult } from './operations.js';
import { OutcomeKindSchema } from '../memory/outcomes.js';
import { evaluateOutcomes } from '../rules/outcomeCalibration.js';

const MIN_BASIS_WORDS = 5;

export const OutcomeInputSchema = z.object({
  sessionId: z.string().min(1),
  outcome: OutcomeKindSchema,
  basis: z.string(),
  reference: z.string().optional(),
});
export type OutcomeInput = z.infer<typeof OutcomeInputSchema>;

export function opOutcome(input: OutcomeInput, ctx?: CycleContext): OpResult {
  if (ctx?.sessions === undefined || ctx.outcomes === undefined) {
    return errorResult(
      'Outcome tracking needs a session store and an outcome log.',
      'outcome:unavailable',
      'Run the server with its default on-disk context (falsify-mcp or falsify-web).',
    );
  }
  const session = ctx.sessions.get(input.sessionId);
  if (session === undefined) {
    return errorResult(`Unknown session '${input.sessionId}'.`, 'session:unknown', 'Use the sessionId from the inquiry that produced the theory.');
  }
  if (session.state !== 'theory' || session.hypothesis === undefined) {
    return errorResult(
      `Session is at '${session.state}', not a confirmed theory.`,
      'outcome:no-theory',
      'Only a theory that completed the cycle (falsify_review, outcome: confirm) can be given an outcome.',
    );
  }
  const basis = input.basis.trim();
  if (basis.split(/\s+/).filter(Boolean).length < MIN_BASIS_WORDS) {
    return errorResult(
      'An outcome must say what happened and how you know.',
      'outcome:basis-required',
      `Give a basis of at least ${MIN_BASIS_WORDS} words: the replication, measurement or event that settled it, and where it is documented.`,
    );
  }

  const score = session.analysis?.score;
  ctx.outcomes.record({
    sessionId: session.id,
    outcome: input.outcome,
    basis,
    ...(input.reference !== undefined && input.reference.trim() !== '' ? { reference: input.reference.trim() } : {}),
    recordedAt: new Date().toISOString(),
    snapshot: {
      statement: session.hypothesis.statement,
      ...(score !== undefined ? { nonConsensusScore: score.nonConsensusScore, evidenceStrength: score.evidenceStrength } : {}),
      hypothesesTried: session.refuted.length + 1,
    },
  });
  ctx.notebook?.record({
    kind: 'outcome',
    text: `${input.outcome}: ${session.hypothesis.statement.trim()} — ${basis}`,
  });

  const report = evaluateOutcomes(ctx.outcomes.current());
  return okResult({
    sessionId: session.id,
    outcome: input.outcome,
    recorded: true,
    note:
      input.outcome === 'refuted'
        ? 'The theory is recorded as refuted by later evidence. Its earlier confirmation stays in the log: a mistake stays visible.'
        : 'Recorded. An outcome can be superseded by a later one; the earlier entry is kept.',
    outcomes: { total: report.total, heldUp: report.heldUp, refuted: report.refuted, message: report.message },
  });
}
