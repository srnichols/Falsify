/**
 * `falsify_related` — find the knowledge a claim touches, before committing to a
 * hypothesis. It runs the same tier matching `falsify_hypothesize` does, plus
 * semantic recall from the Corpus when it is reachable, so paraphrases the
 * lexical matcher misses can still surface (see `semanticMatch.ts`).
 */

import { buildKnowledgeIndex } from '../rules/knowledgeMatch.js';
import type { KnowledgeIndex } from '../rules/knowledgeMatch.js';
import { matchKnowledgeSemantic } from '../rules/semanticMatch.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import type { CycleContext } from './context.js';
import { errorResult, okResult } from './operations.js';
import type { OpResult } from './operations.js';

export interface RelatedInput {
  claim: string;
  limit?: number | undefined;
}

let cachedIndex: KnowledgeIndex | undefined;

/** Match a claim against the tiers (lexical, plus semantic when the Corpus is reachable). */
export async function opRelated(input: RelatedInput, ctx?: CycleContext): Promise<OpResult> {
  let index: KnowledgeIndex;
  try {
    index = ctx?.knowledge ?? (cachedIndex ??= buildKnowledgeIndex(loadAllKnowledge()));
  } catch {
    return errorResult(
      'The knowledge corpus could not be loaded.',
      'related:knowledge-unavailable',
      'Check that the knowledge/ directory exists and passes `npm run knowledge -- lint`.',
    );
  }

  const { matches, semantic } = await matchKnowledgeSemantic(index, ctx?.memory, input.claim, {
    embeddings: ctx?.embeddings,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  return okResult({
    claim: input.claim,
    matches,
    count: matches.length,
    semantic,
    ...(matches.length === 0
      ? {
          message:
            semantic === 'unavailable'
              ? 'Nothing in the corpus matched by wording, and semantic search is unavailable (OPENBRAIN_KEY unset or the brain is unreachable). Absence of a match is not absence of relevant knowledge.'
              : 'Nothing in the corpus matched this claim. Absence of a match is not absence of relevant knowledge.',
        }
      : {}),
  });
}
