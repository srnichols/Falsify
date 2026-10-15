import type { Evidence } from '../../src/domain/evidence.js';
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

/** An independently replicated experiment: rated "strong". */
export const STRONG_EVIDENCE: Evidence = { ...MODERATE_EVIDENCE, replicated: true };

/** Analysis input fields that clear every session "yes" requirement. */
export const CLEAN_YES = { verdict: 'yes', evidence: [MODERATE_EVIDENCE], evidenceSearch: SEARCH } as const;
