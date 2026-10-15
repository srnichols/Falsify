/**
 * Integrity checks on an analysis — the biases the form-checks cannot see.
 *
 * The cycle's earlier rules check that a hypothesis has a falsifier and that an
 * analysis cites evidence. They do not ask whether the verdict agrees with the
 * statistics it cites, how many chances there were to find a p-value, or what the
 * evidence search left out. A biased agent can pass every one of those and still
 * report a confident, tidy "yes". These rules close that gap where it can be closed
 * deterministically:
 *
 *  - a "yes" must survive a multiplicity correction (outcomes tested, hypotheses
 *    already tried), unless a replication or an explicit null-effect claim says
 *    otherwise;
 *  - a p-value must come with the number of outcomes tested;
 *  - a "yes" must disclose what was searched and whether contrary results exist,
 *    and contrary results cap the strength it can claim.
 *
 * What they cannot do is detect a lie: an agent that reports "1 outcome tested" or
 * "no contrary results found" falsely passes. They raise the cost of bias and make
 * every such claim a recorded, challengeable statement.
 */

import { adjustedPValue } from '../domain/evidence.js';
import type { ResolvedEvidence } from '../domain/evidence.js';

/** What the analyst searched and what contradicted the claim. */
export interface EvidenceSearch {
  /** Where and how evidence was looked for (databases, queries, the experiment itself). */
  description: string;
  /** How many null or contrary results are known. */
  contraryFound: number;
  /** If any: what they are and why the claim stands in spite of them. */
  contraryNote?: string | undefined;
}

export interface IntegrityInput {
  verdict: 'yes' | 'no';
  items: readonly ResolvedEvidence[];
  evidenceSearch?: EvidenceSearch | undefined;
  /** The hypothesis itself asserts no effect, so a non-significant result supports it. */
  nullHypothesisClaim?: boolean | undefined;
  /** Hypotheses already tried and refuted in this inquiry. */
  refutedAttempts: number;
  /** In a session the full set of disclosures is required; stateless runs get the core checks only. */
  strict: boolean;
}

export interface IntegrityFinding {
  rule: string;
  error: string;
  guidance: string;
}

export interface IntegrityResult {
  refusal?: IntegrityFinding;
  /** Non-blocking observations to add to the result. */
  flags: Record<string, unknown>;
  /** Present when any evidence carried a p-value. */
  multiplicity?: {
    attempts: number;
    adjustedPValues: { observation: string; p: number; outcomesTested: number; adjusted: number }[];
  };
  /** Contrary results were disclosed, so the claimed strength is capped. */
  contraryCap: boolean;
}

/** Phrases that report no effect; a "yes" resting on them is probably misreported. */
const NULL_RESULT_PHRASES =
  /\b(?:no (?:significant |statistically significant |measurable )?(?:difference|effect|change|association|relationship)|did not differ|not significantly|not statistically significant|failed to (?:replicate|find|show|detect)|no evidence (?:of|for))\b/i;

/** Significance level the adjusted p-value must clear for a "yes" to rest on it. */
const ALPHA = 0.05;
const MIN_SEARCH_WORDS = 5;

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

function refuse(rule: string, error: string, guidance: string): IntegrityResult {
  return { refusal: { rule, error, guidance }, flags: {}, contraryCap: false };
}

/** Apply the integrity rules to an analysis. Pure. */
export function assessIntegrity(input: IntegrityInput): IntegrityResult {
  const { verdict, items, evidenceSearch, refutedAttempts, strict } = input;
  const attempts = refutedAttempts + 1;
  const flags: Record<string, unknown> = {};

  const statistical = items.filter((i) => i.kind !== 'consensus' && i.pValue !== undefined);
  const adjusted = statistical.map((item) => ({
    item,
    value: adjustedPValue(item.pValue!, item.outcomesTested, attempts),
  }));
  const adjustedPValues = adjusted.map(({ item, value }) => ({
    observation: item.observation,
    p: item.pValue!,
    outcomesTested: item.outcomesTested ?? 1,
    adjusted: value,
  }));
  const multiplicity = statistical.length > 0 ? { attempts, adjustedPValues } : undefined;

  if (verdict === 'no') {
    return { flags, ...(multiplicity ? { multiplicity } : {}), contraryCap: false };
  }

  if (strict) {
    const undeclared = statistical.filter((i) => i.outcomesTested === undefined && i.replicated !== true);
    if (undeclared.length > 0) {
      return refuse(
        'analysis:outcomes-tested-required',
        'A p-value needs the number of outcomes or comparisons examined to get it.',
        `Set outcomesTested on: ${undeclared.map((i) => `"${i.observation}"`).join('; ')}. Use 1 only if exactly one outcome was analysed; be honest, a p-value from the best of 20 outcomes is not a p-value.`,
      );
    }

    if (evidenceSearch === undefined || words(evidenceSearch.description) < MIN_SEARCH_WORDS) {
      return refuse(
        'analysis:search-disclosure-required',
        'A "yes" must say what was searched and whether contrary results exist.',
        'Pass evidenceSearch: {description: where and how you looked (at least five words), contraryFound: how many null or contrary results are known, contraryNote: what they are, if any}.',
      );
    }
    if (evidenceSearch.contraryFound > 0 && (evidenceSearch.contraryNote ?? '').trim().split(/\s+/).filter(Boolean).length < 5) {
      return refuse(
        'analysis:contrary-evidence-unexplained',
        `${evidenceSearch.contraryFound} contrary result(s) were reported but not explained.`,
        'Add evidenceSearch.contraryNote: what the contrary results are, and why the claim stands in spite of them.',
      );
    }
  }

  const hasReplication = items.some((i) => i.kind !== 'consensus' && i.replicated === true);
  const unreplicated = adjusted.filter(({ item }) => item.replicated !== true);
  if (
    input.nullHypothesisClaim !== true &&
    !hasReplication &&
    unreplicated.length > 0 &&
    unreplicated.every(({ value }) => value >= ALPHA)
  ) {
    const best = Math.min(...unreplicated.map(({ value }) => value));
    return {
      ...refuse(
        'analysis:not-significant-after-adjustment',
        `A "yes" rests on statistics that do not clear p < ${ALPHA} once multiplicity is counted (best adjusted p = ${best.toFixed(3)}, over ${attempts} hypothesis attempt(s) and the outcomes tested).`,
        'Either the effect is not established (record "no" and revise), or provide an independent replication. If the hypothesis itself asserts NO effect, set nullHypothesisClaim: true.',
      ),
      ...(multiplicity ? { multiplicity } : {}),
    };
  }

  const nullPhrased = items.filter((i) => i.kind !== 'consensus' && NULL_RESULT_PHRASES.test(i.observation));
  if (nullPhrased.length > 0 && input.nullHypothesisClaim !== true) {
    flags.verdictMayContradictEvidence = {
      observations: nullPhrased.map((i) => i.observation),
      note: 'These items read as reporting no effect, yet the verdict is "yes". If that is deliberate (the hypothesis asserts no effect), set nullHypothesisClaim: true; otherwise check the verdict.',
    };
  }

  return {
    flags,
    ...(multiplicity ? { multiplicity } : {}),
    contraryCap: (evidenceSearch?.contraryFound ?? 0) > 0,
  };
}
