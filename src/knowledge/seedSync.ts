/**
 * Seed-sync (DESIGN.md §4 "two stores, one truth").
 *
 * The `knowledge/*.yaml` files are the source of truth. This module mirrors them
 * into OpenBrain as searchable memories so the cycle's `recall` step can do fuzzy
 * lookups — the brain is a *copy*, never canonical. Bedrock stays exact and
 * auditable in git; the index is disposable and rebuildable from it.
 *
 * The pure {@link buildSeedMemories} converts a loaded knowledge base into the
 * exact `BrainMemory[]` that will be pushed — fully testable with no network.
 * {@link syncSeed} is the thin layer that actually saves them via an
 * {@link OpenBrainClient}.
 */

import type {
  Tier,
  KnowledgeEntry,
  FactEntry,
  ContestedEntry,
  QuantEntry,
  RefutedEntry,
} from '../domain/types.js';
import type { KnowledgeFile } from './loader.js';
import type { BrainMemory, MemoryWriter } from '../memory/openbrainClient.js';

/** Source label stamped on every seeded memory, for later provenance filtering. */
export const SEED_SOURCE = 'falsify-knowledge-seed';

// ─── Discriminators for the KnowledgeEntry union ─────────────────────────────

function isContested(entry: KnowledgeEntry): entry is ContestedEntry {
  return 'positions' in entry;
}
function isQuant(entry: KnowledgeEntry): entry is QuantEntry {
  return 'principle' in entry;
}
function isRefuted(entry: KnowledgeEntry): entry is RefutedEntry {
  return 'falsified_by' in entry;
}
function isFact(entry: KnowledgeEntry): entry is FactEntry {
  return 'statement' in entry && 'falsified_if' in entry && !isContested(entry) && !isQuant(entry);
}

/**
 * Convert a single knowledge entry into the memory that represents it in the
 * brain. The `content` is the text that gets embedded for semantic recall; the
 * `metadata` always carries `{ tier, source_id, falsifiable, falsified_if }` per
 * DESIGN.md, plus tier-appropriate extras.
 */
export function entryToMemory(tier: Tier, entry: KnowledgeEntry): BrainMemory {
  const base = { source: SEED_SOURCE } as const;

  if (isContested(entry)) {
    const positions = entry.positions
      .map((p) => `- ${p.label}: ${p.claim} [${p.falsifiability_status}]`)
      .join('\n');
    return {
      ...base,
      content: `Contested question: ${entry.question}\nPositions:\n${positions}`,
      metadata: {
        tier,
        source_id: entry.id,
        domain: entry.domain,
        kind: 'contested',
        engine_directive: entry.engine_directive,
        positions: entry.positions,
        // Contested entries are falsifiable per-position, never as a whole.
        falsifiable: 'per-position',
      },
    };
  }

  if (isQuant(entry)) {
    return {
      ...base,
      content: `Quantitative lens — ${entry.principle}: ${entry.statement}`,
      metadata: {
        tier,
        source_id: entry.id,
        kind: 'quantitative',
        triggers: entry.triggers,
        failure_guarded: entry.failure_guarded,
        ...(entry.formula !== undefined ? { formula: entry.formula } : {}),
        // A cross-cutting tool, not a falsifiable empirical claim.
        falsifiable: 'not-applicable',
      },
    };
  }

  if (isRefuted(entry)) {
    return {
      ...base,
      content: `Refuted claim: ${entry.claim}\nFalsified by: ${entry.falsified_by}\nLesson: ${entry.lesson}`,
      metadata: {
        tier,
        source_id: entry.id,
        domain: entry.domain,
        kind: 'refuted',
        falsified_by: entry.falsified_by,
        lesson: entry.lesson,
        ...(entry.superseded_by !== undefined ? { superseded_by: entry.superseded_by } : {}),
        ...(entry.era !== undefined ? { era: entry.era } : {}),
        // It WAS falsifiable and it WAS falsified — that is the whole point.
        falsifiable: true,
      },
    };
  }

  // Fact entry (bedrock / established).
  const fact = entry as FactEntry;
  if (!isFact(fact)) {
    throw new Error(`Unrecognized knowledge entry shape (tier ${tier}).`);
  }
  return {
    ...base,
    content: `${fact.statement} (${fact.domain})`,
    metadata: {
      tier,
      source_id: fact.id,
      domain: fact.domain,
      type: fact.type,
      status: fact.status,
      kind: 'fact',
      falsifiable: fact.falsifiable,
      falsified_if: fact.falsified_if,
      ...(fact.domain_of_validity !== undefined
        ? { domain_of_validity: fact.domain_of_validity }
        : {}),
    },
  };
}

/**
 * Build every memory for an entire loaded knowledge base, in a deterministic
 * order (tier order, then file order). Pure — no network, no client.
 */
export function buildSeedMemories(
  knowledge: Record<Tier, KnowledgeFile>,
): BrainMemory[] {
  const memories: BrainMemory[] = [];
  for (const [tier, file] of Object.entries(knowledge) as [Tier, KnowledgeFile][]) {
    for (const entry of file.entries) {
      memories.push(entryToMemory(tier, entry));
    }
  }
  return memories;
}

/** Per-memory outcome of a sync run. */
export interface SeedSyncItem {
  sourceId: string;
  tier: Tier;
  saved: boolean;
  queued: boolean;
}

/** Aggregate result of a sync run. */
export interface SeedSyncSummary {
  total: number;
  saved: number;
  queued: number;
  items: SeedSyncItem[];
}

/**
 * Push every seed memory into OpenBrain via any {@link MemoryWriter}. A memory
 * that cannot be sent (brain offline) is queued by the writer and reported as
 * `queued` — the run never throws on a transport failure, so a partial sync
 * degrades cleanly.
 */
export async function syncSeed(
  client: MemoryWriter,
  knowledge: Record<Tier, KnowledgeFile>,
): Promise<SeedSyncSummary> {
  const memories = buildSeedMemories(knowledge);
  const items: SeedSyncItem[] = [];
  let saved = 0;
  let queued = 0;

  for (const memory of memories) {
    const meta = memory.metadata as { tier: Tier; source_id: string };
    const result = await client.save(memory);
    if (result.saved) saved += 1;
    if (result.queued) queued += 1;
    items.push({
      sourceId: meta.source_id,
      tier: meta.tier,
      saved: result.saved,
      queued: result.queued,
    });
  }

  return { total: memories.length, saved, queued, items };
}
