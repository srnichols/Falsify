/**
 * `falsify_verify_source` — confirm that a cited DOI exists (see `sourceCheck.ts`).
 *
 * Evidence whose DOI is verified in a session earns more credit in the claim score
 * than one with a bare, typed-in `source`. Verification says the work is real, not
 * that it supports the claim.
 */

import { normalizeDoi } from '../domain/evidence.js';
import { checkDoi, titleRelatesTo } from '../rules/sourceCheck.js';
import { judgeSupport } from '../rules/judge.js';
import type { CycleContext } from './context.js';
import { errorResult, okResult } from './operations.js';
import type { OpResult } from './operations.js';

export interface VerifySourceInput {
  doi: string;
  sessionId?: string | undefined;
  /** The observation you cite this work for. With a judge configured, its abstract is checked against it. */
  observation?: string | undefined;
}

export async function opVerifySource(input: VerifySourceInput, ctx?: CycleContext): Promise<OpResult> {
  const doi = normalizeDoi(input.doi);
  if (doi === undefined) {
    return errorResult(
      `'${input.doi}' is not a DOI.`,
      'source:malformed-doi',
      'Pass a DOI such as 10.1103/PhysRevLett.116.061102 (a https://doi.org/ URL also works).',
    );
  }

  let session;
  if (input.sessionId !== undefined) {
    session = ctx?.sessions?.get(input.sessionId);
    if (session === undefined) {
      return errorResult(
        `No session '${input.sessionId}'.`,
        'session:unknown',
        'Pass the sessionId from falsify_intake, or omit it to just look the DOI up.',
      );
    }
  }

  const check = await (ctx?.verifySource ?? ((d: string) => checkDoi(d)))(doi);
  if (!check.verified) {
    return okResult({
      doi,
      verified: false,
      reason: check.reason,
      note:
        check.reason === 'not-found'
          ? 'Crossref has no record of this DOI. Check it for typos; if it is correct, the source may not be a registered publication.'
          : 'The registry could not be reached, so nothing was verified. Evidence keeps only the small credit for an asserted source.',
    });
  }

  // Advisory only: a model reading the abstract against the observation you cite it for.
  let supportAdvice: Record<string, unknown> | undefined;
  let support: 'yes' | 'no' | 'unclear' | undefined;
  if (ctx?.judge !== undefined && input.observation !== undefined) {
    if (check.abstract === undefined) {
      support = 'unclear';
      supportAdvice = {
        supports: 'unclear',
        reason: 'No abstract is published for this work, so there was nothing to check the observation against.',
        model: ctx.judge.model,
      };
    } else {
      const judgment = await judgeSupport(ctx.judge, input.observation, check.abstract);
      support = judgment.supports;
      supportAdvice = {
        ...judgment,
        model: ctx.judge.model,
        note: "Advisory: a language model's reading of the abstract, which can be wrong. It never changes the score.",
      };
    }
  }

  if (session !== undefined && ctx?.sessions !== undefined) {
    session.verifiedSources = {
      ...session.verifiedSources,
      [doi]: {
        title: check.title,
        ...(check.venue !== undefined ? { venue: check.venue } : {}),
        ...(check.year !== undefined ? { year: check.year } : {}),
        ...(support !== undefined ? { support } : {}),
        checkedAt: new Date().toISOString(),
      },
    };
    ctx.sessions.save(session);
  }

  const claimText = session?.hypothesis !== undefined ? [session.hypothesis.statement, session.hypothesis.predicts] : undefined;
  return okResult({
    doi,
    verified: true,
    title: check.title,
    venue: check.venue,
    year: check.year,
    authors: check.authors,
    hasAbstract: check.abstract !== undefined,
    ...(session !== undefined ? { sessionId: session.id, recordedInSession: true } : {}),
    ...(supportAdvice !== undefined ? { supportAdvice } : {}),
    ...(claimText !== undefined && !titleRelatesTo(check.title, claimText)
      ? { warning: 'This title shares no terms with your hypothesis. If it is the work you meant, name the shared subject in the evidence observation; otherwise cite the work that reports this observation.' }
      : {}),
    note: 'This confirms the work exists, not that it supports your claim. Check that the title is the work you meant.',
  });
}
