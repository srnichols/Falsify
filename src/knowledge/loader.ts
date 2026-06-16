/**
 * Knowledge loader — reads the version-controlled `knowledge/*.yaml` source of
 * truth and validates every entry through the domain schemas (DESIGN.md §4).
 *
 * The YAML files are canonical; OpenBrain is only a searchable mirror. This
 * loader is therefore strict: a seed file that does not satisfy the schema is a
 * bug to fix at the source, not something to coerce.
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { TierSchema, KnowledgeEntrySchema } from '../domain/schemas.js';
import type { Tier, KnowledgeEntry } from '../domain/types.js';

/** The on-disk shape of a single tier file: tier, weight, and its entries. */
export const KnowledgeFileSchema = z.object({
  tier: TierSchema,
  weight: z.union([z.number().nonnegative(), z.literal('cross-cutting')]),
  entries: z.array(KnowledgeEntrySchema).min(1),
});

export type KnowledgeFile = z.infer<typeof KnowledgeFileSchema>;

/** The tier files that make up the seed knowledge base. */
export const TIER_FILES: Readonly<Record<Tier, string>> = {
  bedrock: 'bedrock.yaml',
  established: 'established.yaml',
  contested: 'contested.yaml',
  quantitative: 'quantitative.yaml',
  refuted: 'refuted.yaml',
};

/** Default location of the knowledge directory, relative to the process cwd. */
export const DEFAULT_KNOWLEDGE_DIR = resolve(process.cwd(), 'knowledge');

/** Parse and validate one tier file. Throws if the file fails its schema. */
export function loadKnowledgeFile(filePath: string): KnowledgeFile {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw) as unknown;
  return KnowledgeFileSchema.parse(parsed);
}

/**
 * Load all tier files from a directory.
 *
 * @returns a record keyed by tier, each with its weight and validated entries.
 * @throws if any file is missing or any entry fails validation.
 */
export function loadAllKnowledge(dir: string = DEFAULT_KNOWLEDGE_DIR): Record<Tier, KnowledgeFile> {
  const out = {} as Record<Tier, KnowledgeFile>;
  for (const [tier, file] of Object.entries(TIER_FILES) as [Tier, string][]) {
    const loaded = loadKnowledgeFile(join(dir, file));
    if (loaded.tier !== tier) {
      throw new Error(`Knowledge file ${file} declares tier '${loaded.tier}' but was loaded as '${tier}'.`);
    }
    out[tier] = loaded;
  }
  return out;
}

/** Flatten all loaded entries into a single list, preserving tier on each. */
export function allEntries(
  knowledge: Record<Tier, KnowledgeFile>,
): Array<{ tier: Tier; entry: KnowledgeEntry }> {
  const result: Array<{ tier: Tier; entry: KnowledgeEntry }> = [];
  for (const [tier, file] of Object.entries(knowledge) as [Tier, KnowledgeFile][]) {
    for (const entry of file.entries) {
      result.push({ tier, entry });
    }
  }
  return result;
}
