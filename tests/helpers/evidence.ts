import type { Evidence } from '../../src/domain/evidence.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { opVerifySource } from '../../src/cycle/verify.js';
import type { EvidenceSearch } from '../../src/rules/integrity.js';

/** A search disclosure with no contrary results, as a session "yes" now requires. */
export const SEARCH: EvidenceSearch = {
  description: 'Searched PubMed and the trial registry for trials of caffeine and reaction time',
  contraryFound: 0,
};

/** An unreplicated but sourced and significant experiment: rated "moderate". */
export const MODERATE_EVIDENCE: Evidence = {
  observation: 'randomized placebo-controlled trial showed faster responses',
  kind: 'experiment',
  source: 'Trial A',
  pValue: 0.004,
  effectSize: 0.3,
  outcomesTested: 1,
};

export const REPLICATION_DOI = '10.1000/replication.1';

/** An independently replicated experiment: rated "strong" once the replication DOI is verified in the session. */
export const STRONG_EVIDENCE: Evidence = { ...MODERATE_EVIDENCE, replicated: true, replicationDoi: REPLICATION_DOI };

/** Confirm the replication DOI in this session, with a title that relates to the caffeine hypothesis. */
export async function verifyReplication(ctx: CycleContext, sessionId: string): Promise<void> {
  const verifying: CycleContext = {
    ...ctx,
    verifySource: async () => ({
      verified: true,
      doi: REPLICATION_DOI,
      title: 'Independent replication: caffeine and reaction time',
      venue: 'Journal',
      year: 2024,
      authors: [],
    }),
  };
  await opVerifySource({ doi: REPLICATION_DOI, sessionId }, verifying);
}

/** Analysis input fields that clear every session "yes" requirement. */
export const CLEAN_YES = { verdict: 'yes', evidence: [MODERATE_EVIDENCE], evidenceSearch: SEARCH } as const;
