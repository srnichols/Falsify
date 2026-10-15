/**
 * Advisory judge hooks — extra eyes on top of the deterministic checks.
 *
 * Each function takes the result the keyword/structure rules already produced and,
 * if a judge model is configured, ADDS advice to it. They never change a verdict, a
 * score, a refusal, or the cycle state: the deterministic rules stay the baseline,
 * and the advice is labelled as the opinion of a fallible model. With no judge, the
 * result is returned untouched.
 */

import type { CycleContext } from './context.js';
import type { OpResult } from './operations.js';
import { judgeConsensusAppeal, judgeFalsifiability } from '../rules/judge.js';

const NOTE = 'Advisory: a language model\'s opinion, which can be wrong. It does not change the verdict.';

/** Add a judge's view of whether the question is falsifiable to a successful intake result. */
export async function adviseIntake(question: string, result: OpResult, ctx: CycleContext | undefined): Promise<OpResult> {
  if (ctx?.judge === undefined || result.kind !== 'ok' || typeof result.payload.falsifiable !== 'boolean') {
    return result;
  }
  const judgment = await judgeFalsifiability(ctx.judge, question);
  const disagrees = result.payload.falsifiable === true && judgment.falsifiable === 'no';
  return {
    kind: 'ok',
    payload: {
      ...result.payload,
      judgeAdvice: { ...judgment, model: ctx.judge.model, note: NOTE },
      ...(disagrees
        ? {
            judgeDisagrees: true,
            judgeGuidance:
              'The judge model thinks no observation could refute this. If you cannot name one, reframe it as an empirical prediction before relying on the cycle.',
          }
        : {}),
    },
  };
}

/** Flag cited evidence that reads as an appeal to authority but slipped past the keyword rules. */
export async function adviseAnalysis(result: OpResult, ctx: CycleContext | undefined): Promise<OpResult> {
  if (ctx?.judge === undefined || result.kind !== 'ok' || !Array.isArray(result.payload.evidence)) {
    return result;
  }
  const items = result.payload.evidence as { observation: string; kind: string }[];
  const flagged: { observation: string; reason: string }[] = [];
  for (const item of items) {
    if (item.kind === 'consensus') continue;
    const judgment = await judgeConsensusAppeal(ctx.judge, item.observation);
    if (judgment.appeal === true) flagged.push({ observation: item.observation, reason: judgment.reason });
  }
  if (flagged.length === 0) {
    return result;
  }
  return {
    kind: 'ok',
    payload: {
      ...result.payload,
      possibleConsensusAppeals: flagged,
      judgeNote: `${NOTE} These items were not treated as consensus, but may be appeals to authority; check that each reports an observation.`,
    },
  };
}
