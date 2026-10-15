/**
 * An optional language-model judge, strictly advisory.
 *
 * Falsify's own checks are keyword and structure rules: they are transparent and
 * deterministic, and they miss anything phrased in a way the rules did not
 * anticipate. A judge model can read what the rules cannot. It is also fallible, in
 * both directions, so it is held to three rules:
 *
 *  1. It is off unless `FALSIFY_JUDGE_URL` is set, and nothing is sent anywhere
 *     before that. A local server (Ollama) keeps every claim on your machine.
 *  2. It only ever adds advice. It never changes a verdict, a score, or a refusal;
 *     the deterministic rules stay the baseline.
 *  3. It is measured. `npm run calibrate:judge` reports its accuracy on labelled
 *     cases next to the keyword baseline, so you know what its advice is worth.
 *
 * Anything it claims about a paper must come with a quote that is actually in the
 * abstract; a quote that is not there is discarded as fabricated.
 */

import { z } from 'zod';

/** Asks a model for a reply. */
export interface Judge {
  readonly model: string;
  complete(system: string, user: string): Promise<string>;
}

/** The slice of `fetch` the judge needs, so tests can inject a fake. */
export type JudgeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpenAiJudgeOptions {
  /** Base URL up to and including `/v1`, e.g. `http://127.0.0.1:11434/v1`. */
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  fetchImpl?: JudgeFetch | undefined;
  timeoutMs?: number | undefined;
}

/** A judge backed by any OpenAI-compatible `/chat/completions` endpoint. */
export function createOpenAiJudge(options: OpenAiJudgeOptions): Judge {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as JudgeFetch);
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    model: options.model,
    async complete(system: string, user: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey !== undefined ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // Status only: never echo a response body that might carry a credential.
          throw new Error(`judge request failed with status ${res.status}`);
        }
        const content = ((await res.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
          ?.content;
        if (typeof content !== 'string') {
          throw new Error('judge response had no message content');
        }
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Pull the first JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const Tri = z.enum(['yes', 'no', 'unclear']);
export type Tri = z.infer<typeof Tri>;

const FalsifiabilityReply = z.object({ falsifiable: Tri, reason: z.string().default('') });
const AppealReply = z.object({ appeal: z.boolean(), reason: z.string().default('') });
const SupportReply = z.object({ supports: Tri, quote: z.string().optional(), reason: z.string().default('') });

export interface FalsifiabilityJudgment {
  falsifiable: Tri;
  reason: string;
}
export interface AppealJudgment {
  appeal: boolean | 'unclear';
  reason: string;
}
export interface SupportJudgment {
  supports: Tri;
  /** A passage from the abstract, verified to be present in it. */
  quote?: string;
  reason: string;
}

const FALSIFIABILITY_SYSTEM = [
  'You judge whether a claim is falsifiable in Popper\'s sense: is there some conceivable observation that would show it to be false?',
  'Answer "no" for value judgments, tautologies and definitions, claims that no observation could contradict, or claims protected from refutation by vagueness.',
  'Answer "yes" for empirical claims, even false or unlikely ones. Answer "unclear" only if you truly cannot tell.',
  'Reply with JSON only: {"falsifiable":"yes"|"no"|"unclear","reason":"one short sentence"}.',
].join(' ');

const APPEAL_SYSTEM = [
  'You decide whether a piece of text offers an appeal to authority or consensus as its justification ("experts agree", "it is well known", "the science is settled", "everyone knows") instead of reporting an observation or measurement.',
  'A text that reports what was measured or observed, even citing a source, is NOT an appeal.',
  'Reply with JSON only: {"appeal":true|false,"reason":"one short sentence"}.',
].join(' ');

const SUPPORT_SYSTEM = [
  'You check whether a scientific abstract reports a stated observation.',
  'Answer "yes" only if the abstract itself says it. Answer "no" if the abstract is about something else or contradicts it. Answer "unclear" if the abstract does not settle it.',
  'If you answer "yes", give "quote": a passage copied exactly from the abstract that reports it.',
  'Reply with JSON only: {"supports":"yes"|"no"|"unclear","quote":"exact passage or omit","reason":"one short sentence"}.',
].join(' ');

/** Ask whether a claim could in principle be shown false. Never throws; failures are "unclear". */
export async function judgeFalsifiability(judge: Judge, claim: string): Promise<FalsifiabilityJudgment> {
  try {
    const parsed = FalsifiabilityReply.safeParse(extractJson(await judge.complete(FALSIFIABILITY_SYSTEM, `Claim: ${claim}`)));
    return parsed.success ? parsed.data : { falsifiable: 'unclear', reason: 'The judge returned an unreadable reply.' };
  } catch {
    return { falsifiable: 'unclear', reason: 'The judge could not be reached.' };
  }
}

/** Ask whether text rests on authority or consensus rather than an observation. */
export async function judgeConsensusAppeal(judge: Judge, text: string): Promise<AppealJudgment> {
  try {
    const parsed = AppealReply.safeParse(extractJson(await judge.complete(APPEAL_SYSTEM, `Text: ${text}`)));
    return parsed.success ? parsed.data : { appeal: 'unclear', reason: 'The judge returned an unreadable reply.' };
  } catch {
    return { appeal: 'unclear', reason: 'The judge could not be reached.' };
  }
}

/** Lowercase words with punctuation removed, so a quote can be matched against an abstract. */
const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

/** Fraction of the quote's words that sit in one unbroken run also found in the abstract. */
const QUOTE_COVERAGE = 0.7;

/**
 * True when a quote really comes from the abstract. Models rarely copy a passage
 * exactly (they swap "It" for "The signal"), so a quote counts if one unbroken run
 * of it covers at least 70% of its words. A quote invented from nothing shares no
 * such run, and is rejected.
 */
export function quoteIsFromAbstract(quote: string, abstract: string): boolean {
  const q = words(quote);
  const a = words(abstract);
  if (q.length === 0) return false;
  let longest = 0;
  // Longest common contiguous run between the quote and the abstract.
  let previous = new Array<number>(a.length + 1).fill(0);
  for (let i = 1; i <= q.length; i++) {
    const current = new Array<number>(a.length + 1).fill(0);
    for (let j = 1; j <= a.length; j++) {
      if (q[i - 1] === a[j - 1]) {
        current[j] = previous[j - 1]! + 1;
        if (current[j]! > longest) longest = current[j]!;
      }
    }
    previous = current;
  }
  return longest / q.length >= QUOTE_COVERAGE;
}

/**
 * Ask whether an abstract reports an observation. A "yes" without a quote that is
 * really in the abstract is downgraded to "unclear": an unverifiable claim about a
 * paper is exactly what a model is prone to invent.
 */
export async function judgeSupport(judge: Judge, observation: string, abstract: string): Promise<SupportJudgment> {
  try {
    const parsed = SupportReply.safeParse(
      extractJson(await judge.complete(SUPPORT_SYSTEM, `Observation: ${observation}\n\nAbstract: ${abstract}`)),
    );
    if (!parsed.success) return { supports: 'unclear', reason: 'The judge returned an unreadable reply.' };
    const { supports, quote, reason } = parsed.data;
    if (supports === 'yes') {
      if (quote === undefined || quote.trim() === '' || !quoteIsFromAbstract(quote, abstract)) {
        return { supports: 'unclear', reason: 'The judge said yes but its quote is not in the abstract, so it is not trusted.' };
      }
      return { supports, quote: quote.trim(), reason };
    }
    return { supports, reason };
  } catch {
    return { supports: 'unclear', reason: 'The judge could not be reached.' };
  }
}
