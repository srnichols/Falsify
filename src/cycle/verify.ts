/**
 * `falsify_verify_source` — confirm that a cited DOI exists (see `sourceCheck.ts`).
 *
 * Evidence whose DOI is verified in a session earns more credit in the claim score
 * than one with a bare, typed-in `source`. Verification says the work is real, not
 * that it supports the claim.
 */

import { normalizeDoi } from '../domain/evidence.js';
import { checkDoi } from '../rules/sourceCheck.js';
import type { CycleContext } from './context.js';
import { errorResult, okResult } from './operations.js';
import type { OpResult } from './operations.js';

export interface VerifySourceInput {
  doi: string;
  sessionId?: string | undefined;
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

  if (session !== undefined && ctx?.sessions !== undefined) {
    session.verifiedSources = {
      ...session.verifiedSources,
      [doi]: {
        title: check.title,
        ...(check.venue !== undefined ? { venue: check.venue } : {}),
        ...(check.year !== undefined ? { year: check.year } : {}),
        checkedAt: new Date().toISOString(),
      },
    };
    ctx.sessions.save(session);
  }

  return okResult({
    doi,
    verified: true,
    title: check.title,
    venue: check.venue,
    year: check.year,
    authors: check.authors,
    ...(session !== undefined ? { sessionId: session.id, recordedInSession: true } : {}),
    note: 'This confirms the work exists, not that it supports your claim. Check that the title is the work you meant.',
  });
}
