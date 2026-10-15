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

/** How an observation was obtained. `consensus` is an appeal to authority, not an observation. */
export const EvidenceKindSchema = z.enum(['experiment', 'observation', 'statistical', 'anecdote', 'consensus']);

export const EvidenceSchema = z.object({
  /** What was observed or measured. */
  observation: z.string().min(1),
  kind: EvidenceKindSchema.optional(),
  /** Where it came from: a citation, dataset, or protocol name. */
  source: z.string().min(1).optional(),
  sampleSize: z.number().int().positive().optional(),
  effectSize: z.number().optional(),
  pValue: z.number().min(0).max(1).optional(),
  /** True when an independent party reproduced the result. */
  replicated: z.boolean().optional(),
});

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

/** An evidence item whose `kind` has been resolved. */
export type ResolvedEvidence = Evidence & { kind: EvidenceKind };

/**
 * Merge free-text and structured evidence into one list with every kind resolved.
 * An item that reads as an appeal to authority is `consensus` whatever it claims
 * to be, so consensus cannot be laundered into an observation by relabelling it.
 */
export function normalizeEvidence(
  cited: readonly string[],
  structured: readonly Evidence[],
  isAppeal: (text: string) => boolean,
): ResolvedEvidence[] {
  const items: Evidence[] = [...cited.map((observation) => ({ observation })), ...structured];
  return items.map((item) => {
    if (isAppeal(item.observation)) {
      return { ...item, kind: 'consensus' as const };
    }
    const inferred: EvidenceKind =
      item.kind ?? (item.pValue !== undefined || item.sampleSize !== undefined ? 'statistical' : 'observation');
    return { ...item, kind: inferred };
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

/** A sample this large earns the full sample-size credit. */
const LARGE_SAMPLE = 300;
const MIN_ADEQUATE_SAMPLE = 30;

/**
 * Reliability of one item in [0, 1]. A heuristic, not a verdict: a base by kind,
 * plus credit for a named source, an adequate sample, and independent replication.
 */
export function evidenceQuality(item: ResolvedEvidence): number {
  if (item.kind === 'consensus') {
    return 0;
  }
  let quality = KIND_BASE[item.kind];
  if (item.source !== undefined) quality += 0.1;
  if (item.sampleSize !== undefined) {
    if (item.sampleSize >= LARGE_SAMPLE) quality += 0.15;
    else if (item.sampleSize >= MIN_ADEQUATE_SAMPLE) quality += 0.1;
  }
  if (item.replicated === true) quality += 0.2;
  return Math.min(1, quality);
}

/**
 * Statistical support in [0, 1] from the strongest statistical item: sample size
 * (log-scaled), a pre-stated significance result, and a reported effect size.
 * Zero when no item reports any statistics — absence is not support.
 */
export function statisticalSupport(items: readonly ResolvedEvidence[]): number {
  let best = 0;
  for (const item of items) {
    if (item.kind === 'consensus') continue;
    let score = 0;
    if (item.sampleSize !== undefined) score += Math.min(0.5, Math.log10(item.sampleSize) / 6);
    if (item.pValue !== undefined) score += item.pValue < 0.01 ? 0.4 : item.pValue < 0.05 ? 0.3 : 0;
    if (item.effectSize !== undefined) score += 0.1;
    best = Math.max(best, score);
  }
  return Math.min(1, best);
}

/** How strongly the observations (not the consensus) support the verdict. */
export type EvidenceStrength = 'weak' | 'moderate' | 'strong';

/** Label a direct-evidence signal. */
export function strengthLabel(directEvidence: number): EvidenceStrength {
  if (directEvidence >= 0.7) return 'strong';
  if (directEvidence >= 0.4) return 'moderate';
  return 'weak';
}
