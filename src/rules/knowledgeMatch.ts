/**
 * Knowledge matching — connects a claim to the tiers it touches (DESIGN.md §4).
 *
 * The Rules Engine is meant to consult the hierarchy during the cycle. This
 * module does that with a deterministic, offline lexical matcher (IDF-weighted
 * token overlap), so it needs no network or model. It surfaces *relevance*, not
 * verdicts: a lexical match cannot prove a claim contradicts a law, so Bedrock and
 * Established matches carry the burden-of-proof rule rather than a conclusion.
 */

import type { Tier, ContestedEntry, FactEntry, RefutedEntry, KnowledgeEntry } from '../domain/types.js';
import type { KnowledgeFile } from '../knowledge/loader.js';

/** One tier entry surfaced as relevant to a claim. */
export interface KnowledgeMatch {
  tier: Tier;
  id: string;
  /** The entry's own wording (statement / claim / question). */
  title: string;
  /** Relevance in (0, 1]. */
  score: number;
  /** What the engine must do with this match. */
  directive: string;
  /** Tier-specific context for the caller (falsifiers, positions, lessons). */
  details: Record<string, unknown>;
  /** How the entry was found; absent on plain lexical results from {@link matchKnowledge}. */
  via?: 'lexical' | 'semantic' | 'both';
}

interface IndexedEntry {
  tier: Tier;
  entry: KnowledgeEntry;
  title: string;
  tokens: Set<string>;
}

/** A searchable view over the loaded knowledge tiers. */
export interface KnowledgeIndex {
  entries: IndexedEntry[];
  /** Inverse-document-frequency weight per token. */
  idf: Map<string, number>;
}

const STOPWORDS = new Set(
  (
    'the and for that this with from are was were has have had not but can will would could should ' +
    'than then its their there these those which what when where who whom how why into onto over under ' +
    'about between within without more most less least very also any all some such only other each both ' +
    'does did done being been out off per via best explain explains ' +
    'after before time mean average adult adults healthy dose faster slower higher lower response responses ' +
    'effect effects result results show shows shown found group groups study trial test tests compared ' +
    'significantly significant increase increases decrease decreases'
  ).split(' '),
);

/** Strip a few common suffixes so "falls"/"falling" and "particles"/"particle" align. */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && /(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Tokenize text into a set of meaningful, stemmed terms. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

function isFact(entry: KnowledgeEntry): entry is FactEntry {
  return 'statement' in entry && 'falsified_if' in entry;
}
function isContested(entry: KnowledgeEntry): entry is ContestedEntry {
  return 'positions' in entry;
}
function isRefuted(entry: KnowledgeEntry): entry is RefutedEntry {
  return 'falsified_by' in entry;
}

/** The searchable text and display title for an entry; `undefined` for the Quantitative lens. */
function describe(entry: KnowledgeEntry): { title: string; text: string } | undefined {
  const keywords = 'keywords' in entry && entry.keywords !== undefined ? entry.keywords.join(' ') : '';
  if (isContested(entry)) {
    const sides = entry.positions.map((p) => `${p.label} ${p.claim}`).join(' ');
    return { title: entry.question, text: `${entry.question} ${entry.domain} ${sides} ${keywords}` };
  }
  if (isRefuted(entry)) {
    return { title: entry.claim, text: `${entry.claim} ${entry.domain} ${keywords}` };
  }
  if (isFact(entry)) {
    return { title: entry.statement, text: `${entry.statement} ${entry.domain} ${keywords}` };
  }
  return undefined;
}

/** Build a searchable index over every non-Quantitative tier entry. */
export function buildKnowledgeIndex(knowledge: Record<Tier, KnowledgeFile>): KnowledgeIndex {
  const entries: IndexedEntry[] = [];
  for (const [tier, file] of Object.entries(knowledge) as [Tier, KnowledgeFile][]) {
    if (tier === 'quantitative') continue;
    for (const entry of file.entries) {
      const described = describe(entry);
      if (described) {
        entries.push({ tier, entry, title: described.title, tokens: tokenize(described.text) });
      }
    }
  }

  const docFreq = new Map<string, number>();
  for (const { tokens } of entries) {
    for (const t of tokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log(1 + entries.length / df));
  }
  return { entries, idf };
}

function weight(index: KnowledgeIndex, tokens: Iterable<string>): number {
  let sum = 0;
  for (const t of tokens) sum += index.idf.get(t) ?? 0;
  return sum;
}

/** Minimum shared terms and relevance for a match to be reported. */
const MIN_SHARED_TERMS = 2;
const MIN_SCORE = 0.25;

function directiveFor(tier: Tier, entry: KnowledgeEntry): { directive: string; details: Record<string, unknown> } {
  if (isRefuted(entry)) {
    return {
      directive:
        'This resembles a claim that was already refuted. Say what is different this time, and which decisive observation the earlier version failed.',
      details: {
        falsified_by: entry.falsified_by,
        lesson: entry.lesson,
        ...(entry.superseded_by !== undefined ? { superseded_by: entry.superseded_by } : {}),
      },
    };
  }
  if (isContested(entry)) {
    return {
      directive: `${entry.engine_directive} Present every position with its falsifiability status; never pick a winner.`,
      details: {
        positions: entry.positions.map((p) => ({ label: p.label, falsifiability_status: p.falsifiability_status })),
      },
    };
  }
  if (isFact(entry)) {
    const bedrock = tier === 'bedrock';
    return {
      directive: bedrock
        ? 'This touches a Bedrock law. A lower tier cannot override it; a contrary claim must either fall outside its domain of validity or bring decisive, reproducible contrary evidence.'
        : 'This touches Established theory. It can be challenged only with decisive contrary evidence; name that evidence.',
      details: {
        falsified_if: entry.falsified_if,
        ...(entry.domain_of_validity !== undefined ? { domain_of_validity: entry.domain_of_validity } : {}),
      },
    };
  }
  return { directive: '', details: {} };
}

/** Find an entry by id, with its tier; `undefined` if the corpus has no such entry. */
export function lookupEntry(index: KnowledgeIndex, id: string): { tier: Tier; entry: KnowledgeEntry } | undefined {
  const found = index.entries.find((e) => e.entry.id === id);
  return found === undefined ? undefined : { tier: found.tier, entry: found.entry };
}

/**
 * Build a match for a known entry id (e.g. one a semantic search returned). The
 * tier, title, and directive always come from the local YAML, never from whatever
 * the search backend stored, so the corpus stays the single source of truth.
 */
export function matchFromId(
  index: KnowledgeIndex,
  id: string,
  score: number,
  via: 'lexical' | 'semantic' | 'both',
): KnowledgeMatch | undefined {
  const indexed = index.entries.find((e) => e.entry.id === id);
  if (indexed === undefined) return undefined;
  const { directive, details } = directiveFor(indexed.tier, indexed.entry);
  return {
    tier: indexed.tier,
    id,
    title: indexed.title,
    score: Math.min(1, Number(score.toFixed(3))),
    directive,
    details,
    via,
  };
}

/** Options for {@link matchKnowledge}. */
export interface MatchOptions {
  /** Maximum matches returned overall. Defaults to 5. */
  limit?: number;
}

/**
 * Find the tier entries most relevant to a claim.
 *
 * @returns matches ordered by relevance, best first.
 */
export function matchKnowledge(index: KnowledgeIndex, text: string, options: MatchOptions = {}): KnowledgeMatch[] {
  const limit = options.limit ?? 5;
  const query = tokenize(text);
  if (query.size === 0) return [];
  const queryWeight = weight(index, query);

  const matches: KnowledgeMatch[] = [];
  for (const indexed of index.entries) {
    const shared = [...query].filter((t) => indexed.tokens.has(t));
    if (shared.length < MIN_SHARED_TERMS) continue;
    const denominator = Math.min(queryWeight, weight(index, indexed.tokens));
    if (denominator === 0) continue;
    const score = weight(index, shared) / denominator;
    if (score < MIN_SCORE) continue;

    const { directive, details } = directiveFor(indexed.tier, indexed.entry);
    matches.push({
      tier: indexed.tier,
      id: indexed.entry.id,
      title: indexed.title,
      score: Math.min(1, Number(score.toFixed(3))),
      directive,
      details,
    });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
