import { opAnalyze, opExperiment, opHypothesize, opIntake } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';

const ok = (r: OpResult): Record<string, unknown> => {
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.rule}: ${r.error}`);
  return r.payload;
};

/**
 * Run the opposite framing of the caffeine inquiry in `ctx` to a "no" verdict, linked to
 * `sessionId` with mirrorOf, and return its session id.
 */
export function runMirror(ctx: CycleContext, sessionId: string, verdict: 'yes' | 'no' = 'no'): string {
  const mirrorId = ok(opIntake({ question: 'Does a 200mg caffeine dose leave reaction time unchanged?', mirrorOf: sessionId }, ctx)).sessionId as string;
  ok(
    opHypothesize(
      {
        statement: 'Caffeine leaves reaction time unchanged',
        predicts: 'no difference from placebo',
        falsificationConditions: [{ description: 'a drop in reaction time versus placebo in a blinded trial' }],
        sessionId: mirrorId,
      },
      [],
      ctx,
    ),
  );
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled test'], sessionId: mirrorId }, ctx));
  ok(
    opAnalyze(
      {
        verdict,
        evidence: [{ observation: 'randomized trial showed faster responses', kind: 'experiment', source: 'Trial A' }],
        evidenceSearch: { description: 'Searched PubMed and the trial registry for caffeine trials', contraryFound: 0 },
        sessionId: mirrorId,
      },
      ctx,
    ),
  );
  return mirrorId;
}
