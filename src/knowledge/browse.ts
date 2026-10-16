/**
 * Read-only browsing of the knowledge corpus for the dashboard: list, search and fetch
 * entries. The YAML files stay the source of truth; this only reads them.
 */

import { loadAllKnowledge } from './loader.js';
import type { KnowledgeFile } from './loader.js';
import type { Tier, KnowledgeEntry } from '../domain/types.js';

export type KnowledgeFiles = Record<Tier, KnowledgeFile>;

export interface KnowledgeSummary {
  id: string;
  tier: Tier;
  /** The entry's own wording: statement, question, claim or principle. */
  title: string;
  domain: string;
  field: string;
  positions: number;
  sources: number;
  keywords: string[];
}

export interface KnowledgeFilters {
  tier?: string | undefined;
  field?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface KnowledgeListing {
  total: number;
  items: KnowledgeSummary[];
  /** Counts over everything matching the search text, ignoring the tier and field filters. */
  facets: { tiers: Record<string, number>; fields: Record<string, number> };
}

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

let cached: KnowledgeFiles | undefined;

/** The corpus, parsed once per process. */
export function defaultKnowledgeFiles(): KnowledgeFiles {
  cached ??= loadAllKnowledge();
  return cached;
}

function field(entry: KnowledgeEntry): { domain: string; field: string } {
  const domain = 'domain' in entry && typeof entry.domain === 'string' ? entry.domain : 'cross-cutting';
  return { domain, field: domain.split('/')[0] ?? domain };
}

function titleOf(entry: KnowledgeEntry): string {
  for (const key of ['statement', 'question', 'claim', 'principle'] as const) {
    const value = (entry as Record<string, unknown>)[key];
    if (typeof value === 'string') return value.trim();
  }
  return entry.id;
}

function summarize(tier: Tier, entry: KnowledgeEntry): KnowledgeSummary {
  const raw = entry as Record<string, unknown>;
  const { domain, field: f } = field(entry);
  return {
    id: entry.id,
    tier,
    title: titleOf(entry),
    domain,
    field: f,
    positions: Array.isArray(raw.positions) ? raw.positions.length : 0,
    sources: Array.isArray(raw.sources) ? raw.sources.length : 0,
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as string[]) : [],
  };
}

/** Relevance of an entry to the search words: title and keyword hits count most. */
function relevance(entry: KnowledgeEntry, summary: KnowledgeSummary, words: string[]): number {
  const title = summary.title.toLowerCase();
  const keywords = summary.keywords.join(' ').toLowerCase();
  const id = entry.id.toLowerCase();
  const rest = JSON.stringify(entry).toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 3;
    else if (keywords.includes(word)) score += 3;
    else if (id.includes(word) || summary.domain.toLowerCase().includes(word)) score += 2;
    else if (rest.includes(word)) score += 1;
    else return 0;
  }
  return score;
}

/** List and search the corpus. Every search word must appear somewhere in the entry. */
export function listKnowledge(files: KnowledgeFiles, filters: KnowledgeFilters = {}): KnowledgeListing {
  const words = (filters.q ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);

  const scored: { summary: KnowledgeSummary; score: number }[] = [];
  for (const [tier, file] of Object.entries(files) as [Tier, KnowledgeFile][]) {
    for (const entry of file.entries) {
      const summary = summarize(tier, entry);
      const score = words.length === 0 ? 1 : relevance(entry, summary, words);
      if (score > 0) scored.push({ summary, score });
    }
  }

  const tiers: Record<string, number> = {};
  const fields: Record<string, number> = {};
  for (const { summary } of scored) {
    tiers[summary.tier] = (tiers[summary.tier] ?? 0) + 1;
    fields[summary.field] = (fields[summary.field] ?? 0) + 1;
  }

  const kept = scored
    .filter(({ summary }) => (filters.tier ? summary.tier === filters.tier : true))
    .filter(({ summary }) => (filters.field ? summary.field === filters.field : true));
  if (words.length > 0) kept.sort((a, b) => b.score - a.score || a.summary.id.localeCompare(b.summary.id));
  else kept.sort((a, b) => a.summary.id.localeCompare(b.summary.id));

  return {
    total: kept.length,
    items: kept.slice(offset, offset + limit).map(({ summary }) => summary),
    facets: { tiers, fields },
  };
}

/** One full entry with its tier, or undefined if the id is unknown. */
export function getKnowledgeEntry(files: KnowledgeFiles, id: string): { tier: Tier; entry: KnowledgeEntry } | undefined {
  for (const [tier, file] of Object.entries(files) as [Tier, KnowledgeFile][]) {
    const entry = file.entries.find((e) => e.id === id);
    if (entry !== undefined) return { tier, entry };
  }
  return undefined;
}
