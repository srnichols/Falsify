/**
 * Substance checks — the second line of defense for the honesty rules.
 *
 * The schemas guarantee a falsification condition, a review answer, or a piece of
 * evidence is *present*. These checks reject the cheap ways to satisfy that rule
 * without meaning it ("if it's wrong", "n/a", "data"). They are deliberately
 * conservative lexical checks: they catch placeholder text, not weak science.
 */

/** Phrases that restate "the hypothesis is false" instead of naming an observation. */
const VACUOUS_CONDITION_PATTERNS: readonly RegExp[] = [
  /^(?:if )?(?:it|this|that|the (?:hypothesis|claim|theory))(?:'s| is| was)? (?:wrong|false|incorrect|untrue|not true|disproven|disproved|falsified)\.?$/i,
  /^(?:if )?(?:i am|i'm|we are|we're) wrong\.?$/i,
  /^(?:if )?(?:proven|shown|found) (?:wrong|false)\.?$/i,
  /^(?:if )?(?:the )?(?:data|evidence|results?) (?:disagree|disagrees|contradicts?) (?:it|this|the (?:hypothesis|claim))\.?$/i,
];

/** Answers that carry no information. */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^(?:n\/?a|none|nothing|nope|nil|tbd|todo|unknown|idk|ok(?:ay)?|fine|yes|no|sure|same|as above|see above)\.?$/i,
];

/** Result of a substance check. */
export type SubstanceResult = { ok: true } | { ok: false; reason: string };

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(text.trim()));
}

/**
 * A falsification condition must describe an observation, not restate that the
 * hypothesis could be wrong.
 */
export function assessFalsificationCondition(description: string): SubstanceResult {
  const text = description.trim();
  if (isPlaceholder(text) || VACUOUS_CONDITION_PATTERNS.some((p) => p.test(text))) {
    return {
      ok: false,
      reason: `'${text}' restates that the hypothesis could be wrong; it does not name an observation.`,
    };
  }
  if (wordCount(text) < 3) {
    return {
      ok: false,
      reason: `'${text}' is too short to describe an observation (use at least three words: what is measured, and what result would refute the claim).`,
    };
  }
  return { ok: true };
}

/** A review answer must engage with its question, not wave it through. */
export function assessReviewAnswer(label: string, answer: string): SubstanceResult {
  const text = answer.trim();
  if (isPlaceholder(text) || wordCount(text) < 3) {
    return {
      ok: false,
      reason: `${label} needs a real answer of at least three words (got '${text}'). Say what you checked and what you found.`,
    };
  }
  return { ok: true };
}

/** An evidence item must name an observation, not a bare noun or placeholder. */
export function assessEvidenceItem(item: string): SubstanceResult {
  const text = item.trim();
  if (isPlaceholder(text) || wordCount(text) < 2) {
    return {
      ok: false,
      reason: `'${text}' is too vague to be evidence; describe the observation or measurement.`,
    };
  }
  return { ok: true };
}

/** First failure across a list of evidence items, or ok. */
export function assessEvidenceList(items: readonly string[]): SubstanceResult {
  for (const item of items) {
    const result = assessEvidenceItem(item);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}
