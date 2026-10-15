/**
 * Semantic knowledge matching — closes the gaps the lexical matcher cannot see.
 *
 * The lexical matcher misses paraphrases ("heavier objects fall faster in a
 * vacuum" never shares two terms with the equivalence principle). The Corpus tier
 * already holds an embedding index of the same entries, so this asks it for
 * candidates, then resolves each hit to its entry in the local YAML by `source_id`.
 * The backend only nominates; tier, wording and directive come from the YAML.
 *
 * It degrades gracefully: with no reader, or a reader that fails, the lexical
 * matches are returned and `semantic` reports why.
 */

import type { MemoryReader } from '../memory/openbrainClient.js';
import { matchFromId, matchKnowledge } from './knowledgeMatch.js';
import type { KnowledgeIndex, KnowledgeMatch } from './knowledgeMatch.js';

/** Outcome of the semantic half of a lookup. */
export type SemanticStatus = 'used' | 'unavailable' | 'no-hits';

export interface SemanticMatchResult {
  matches: KnowledgeMatch[];
  semantic: SemanticStatus;
}

const SOURCE_ID_PATTERN = /source_id:\s*([A-Za-z0-9_.-]+)/;

/** Render a recall hit as text so its folded `source_id:` line can be found. */
function hitText(hit: unknown): string {
  if (typeof hit === 'string') return hit;
  if (hit !== null && typeof hit === 'object') {
    const content = (hit as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    return JSON.stringify(hit);
  }
  return '';
}

/** A hit's own similarity if it reports one in (0, 1]; otherwise undefined. */
function hitSimilarity(hit: unknown): number | undefined {
  if (hit === null || typeof hit !== 'object') return undefined;
  const record = hit as Record<string, unknown>;
  for (const key of ['similarity', 'score']) {
    const value = record[key];
    if (typeof value === 'number' && value > 0 && value <= 1) return value;
  }
  return undefined;
}

/** Rank-based fallback when a hit reports no similarity: best hit 0.8, then falling. */
function rankScore(rank: number): number {
  return Math.max(0.4, 0.8 - 0.07 * rank);
}

/**
 * Match a claim against the knowledge tiers using lexical overlap and, when a
 * reader is available, semantic recall. An entry found both ways keeps the higher
 * score and is marked `both`.
 */
export async function matchKnowledgeSemantic(
  index: KnowledgeIndex,
  reader: MemoryReader | undefined,
  text: string,
  options: { limit?: number } = {},
): Promise<SemanticMatchResult> {
  const limit = options.limit ?? 5;
  const merged = new Map<string, KnowledgeMatch>();
  for (const match of matchKnowledge(index, text, { limit: limit * 2 })) {
    merged.set(match.id, { ...match, via: 'lexical' });
  }

  let semantic: SemanticStatus = 'unavailable';
  if (reader !== undefined) {
    try {
      const hits = await reader.recall({ query: text, limit: limit * 2 });
      semantic = 'no-hits';
      hits.forEach((hit, rank) => {
        const id = SOURCE_ID_PATTERN.exec(hitText(hit))?.[1];
        if (id === undefined) return;
        const score = hitSimilarity(hit) ?? rankScore(rank);
        const existing = merged.get(id);
        if (existing !== undefined) {
          merged.set(id, { ...existing, score: Math.max(existing.score, score), via: 'both' });
          semantic = 'used';
          return;
        }
        const found = matchFromId(index, id, score, 'semantic');
        if (found !== undefined) {
          merged.set(id, found);
          semantic = 'used';
        }
      });
    } catch {
      semantic = 'unavailable';
    }
  }

  const matches = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return { matches, semantic };
}
