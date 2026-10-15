/**
 * Structured evidence — what an analysis actually rests on.
 *
 * Free-text `evidenceCited` strings are still accepted, but they carry no
 * provenance, so they cannot tell a replicated randomized trial from an anecdote.
 * An {@link Evidence} item can say what kind of observation it is, where it came
 * from, and how strong the statistics are; {@link evidenceQuality} turns that into
 * a number the claim score can use.
 */

import { z } from 'zod';
import { effectToR, replicationProbability } from '../rules/replicationModel.js';

/** How an observation was obtained. `consensus` is an appeal to authority, not an observation. */
export const EvidenceKindSchema = z.enum(['experiment', 'observation', 'statistical', 'anecdote', 'consensus']);

/** A DOI as published ("10.1103/PhysRevLett.116.061102"); a doi.org URL is accepted and normalized. */
export const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

/** Reduce "https://doi.org/10.x/y" or "doi:10.x/y" to the bare lowercase DOI; `undefined` if malformed. */
export function normalizeDoi(input: string): string | undefined {
  const bare = input
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase();
  return DOI_PATTERN.test(bare) ? bare : undefined;
}

export const EvidenceSchema = z.object({
  /** What was observed or measured. */
  observation: z.string().min(1),
  kind: EvidenceKindSchema.optional(),
  /** Where it came from: a citation, dataset, or protocol name. Asserted, not checked. */
  source: z.string().min(1).optional(),
  /** The source's DOI. Earns more credit than a bare `source` once checked with `falsify_verify_source`. */
  doi: z.string().min(1).refine((v) => normalizeDoi(v) !== undefined, 'not a valid DOI').optional(),
  sampleSize: z.number().int().positive().optional(),
  /** Effect size. A correlation (|x| <= 1) unless `effectMetric` says it is Cohen's d. */
  effectSize: z.number().optional(),
  effectMetric: z.enum(['r', 'd']).optional(),
  pValue: z.number().min(0).max(1).optional(),
  /** True when an independent party reproduced the result. */
  replicated: z.boolean().optional(),
});

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

/** An evidence item whose `kind` has been resolved, and whose DOI (if any) has been looked up. */
export type ResolvedEvidence = Evidence & {
  kind: EvidenceKind;
  /** True only when the DOI was confirmed to exist in this session and its title relates to the claim. */
  sourceVerified?: boolean;
  /** The DOI exists but its title shares nothing with the claim or observation: possibly unrelated. */
  sourceTopicMismatch?: boolean;
};

/**
 * Merge free-text and structured evidence into one list with every kind resolved.
 * An item that reads as an appeal to authority is `consensus` whatever it claims
 * to be, so consensus cannot be laundered into an observation by relabelling it.
 * `verifiedDois` are the DOIs already confirmed for this inquiry.
 */
export function normalizeEvidence(
  cited: readonly string[],
  structured: readonly Evidence[],
  isAppeal: (text: string) => boolean,
  verifiedDois: ReadonlySet<string> = new Set(),
): ResolvedEvidence[] {
  const items: Evidence[] = [...cited.map((observation) => ({ observation })), ...structured];
  return items.map((item) => {
    if (isAppeal(item.observation)) {
      return { ...item, kind: 'consensus' as const };
    }
    const inferred: EvidenceKind =
      item.kind ?? (item.pValue !== undefined || item.sampleSize !== undefined ? 'statistical' : 'observation');
    const doi = item.doi !== undefined ? normalizeDoi(item.doi) : undefined;
    return { ...item, kind: inferred, ...(doi !== undefined && verifiedDois.has(doi) ? { sourceVerified: true } : {}) };
  });
}

/** Base reliability by kind, before provenance and statistics are credited. */
const KIND_BASE: Record<EvidenceKind, number> = {
  experiment: 0.6,
  statistical: 0.6,
  observation: 0.4,
  anecdote: 0.1,
  consensus: 0,
};

/** Multiplier on the reliability of a result nobody has reproduced (about 39% of RPP studies replicated). */
const UNREPLICATED_DISCOUNT = 0.75;
/** What a result an independent party has reproduced is worth as statistical support. */
const REPLICATED_SUPPORT = 0.9;

/**
 * Reliability of one item in [0, 1]. A heuristic, not a verdict: a base by kind,
 * plus credit for a named source and for independent replication. Sample size earns
 * nothing: in the Reproducibility Project it did not predict which results held up.
 */
export function evidenceQuality(item: ResolvedEvidence): number {
  if (item.kind === 'consensus') {
    return 0;
  }
  let quality = KIND_BASE[item.kind];
  // A source anyone can type earns little; one confirmed to exist earns more.
  if (item.sourceVerified === true) quality += 0.15;
  else if (item.source !== undefined || item.doi !== undefined) quality += 0.05;
  if (item.replicated === true) quality += 0.2;
  // An unreplicated result is fragile however it is dressed: the replication record, not the
  // p-value, is what separates results that survive from ones that do not.
  return Math.min(1, item.replicated === true ? quality : quality * UNREPLICATED_DISCOUNT);
}

/**
 * An item's effect size as a correlation, if it reports one. The metric defaults to
 * a correlation when the value could be one (|x| <= 1) and to Cohen's d otherwise.
 */
function effectAsR(item: Evidence): number | undefined {
  if (item.effectSize === undefined) return undefined;
  const metric = item.effectMetric ?? (Math.abs(item.effectSize) <= 1 ? 'r' : 'd');
  return effectToR(item.effectSize, metric);
}

/**
 * Statistical support in [0, 1] from the strongest item that reports a p-value: the
 * probability, from a model fitted to real replication outcomes, that a result with
 * these statistics replicates; 0.9 if it already has. Zero when no item reports a
 * p-value. Absence is not support, and neither is a big sample on its own.
 */
export function statisticalSupport(items: readonly ResolvedEvidence[]): number {
  let best = 0;
  for (const item of items) {
    if (item.kind === 'consensus' || item.pValue === undefined) continue;
    const support =
      item.replicated === true
        ? REPLICATED_SUPPORT
        : replicationProbability({ pValue: item.pValue, effectR: effectAsR(item) });
    best = Math.max(best, support);
  }
  return best;
}

/** How strongly the observations (not the consensus) support the verdict. */
export type EvidenceStrength = 'weak' | 'moderate' | 'strong';

/**
 * Label a direct-evidence signal. "Strong" needs a replicated result: however large
 * the effect, a result no one has reproduced is at best moderate.
 */
export function strengthLabel(directEvidence: number, hasReplication = true): EvidenceStrength {
  if (directEvidence >= 0.7 && hasReplication) return 'strong';
  if (directEvidence >= 0.4) return 'moderate';
  return 'weak';
}
