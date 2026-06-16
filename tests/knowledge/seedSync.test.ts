import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import {
  buildSeedMemories,
  entryToMemory,
  syncSeed,
  SEED_SOURCE,
} from '../../src/knowledge/seedSync.js';
import type {
  OpenBrainClient,
  BrainMemory,
  SaveResult,
} from '../../src/memory/openbrainClient.js';

const KNOWLEDGE_DIR = resolve(process.cwd(), 'knowledge');
const KNOWLEDGE = loadAllKnowledge(KNOWLEDGE_DIR);

describe('buildSeedMemories', () => {
  it('produces one memory per knowledge entry', () => {
    const total = Object.values(KNOWLEDGE).reduce((n, f) => n + f.entries.length, 0);
    const memories = buildSeedMemories(KNOWLEDGE);
    expect(memories.length).toBe(total);
  });

  it('stamps every memory with the seed source and required metadata contract', () => {
    for (const m of buildSeedMemories(KNOWLEDGE)) {
      expect(m.source).toBe(SEED_SOURCE);
      const meta = m.metadata as Record<string, unknown>;
      expect(typeof meta.tier).toBe('string');
      expect(typeof meta.source_id).toBe('string');
      expect('falsifiable' in meta).toBe(true);
      expect(m.content.length).toBeGreaterThan(0);
    }
  });

  it('source_ids are unique across the whole corpus', () => {
    const ids = buildSeedMemories(KNOWLEDGE).map((m) => (m.metadata as { source_id: string }).source_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('entryToMemory — tier-specific shaping', () => {
  it('a bedrock fact carries falsified_if and its type', () => {
    const m = entryToMemory('bedrock', {
      id: 'bedrock.energy.conservation',
      statement: 'Energy is conserved in an isolated system.',
      domain: 'physics/thermodynamics',
      type: 'law',
      falsifiable: true,
      falsified_if: 'An isolated system gains or loses total energy.',
      status: 'unrefuted',
      confidence: 'high',
      sources: ['First law of thermodynamics'],
    });
    const meta = m.metadata as Record<string, unknown>;
    expect(meta.kind).toBe('fact');
    expect(meta.falsifiable).toBe(true);
    expect(meta.falsified_if).toMatch(/gains or loses/);
  });

  it('a contested entry is marked per-position and keeps its directive', () => {
    const contested = KNOWLEDGE.contested.entries[0]!;
    const m = entryToMemory('contested', contested);
    const meta = m.metadata as Record<string, unknown>;
    expect(meta.kind).toBe('contested');
    expect(meta.falsifiable).toBe('per-position');
    expect(typeof meta.engine_directive).toBe('string');
    expect(m.content).toMatch(/Positions:/);
  });

  it('a quantitative lens is marked not-applicable for falsifiability', () => {
    const quant = KNOWLEDGE.quantitative.entries[0]!;
    const m = entryToMemory('quantitative', quant);
    const meta = m.metadata as Record<string, unknown>;
    expect(meta.kind).toBe('quantitative');
    expect(meta.falsifiable).toBe('not-applicable');
  });

  it('a refuted entry records falsified_by + lesson and is falsifiable:true', () => {
    const refuted = KNOWLEDGE.refuted.entries[0]!;
    const m = entryToMemory('refuted', refuted);
    const meta = m.metadata as Record<string, unknown>;
    expect(meta.kind).toBe('refuted');
    expect(meta.falsifiable).toBe(true); // it was tested and it failed
    expect(typeof meta.falsified_by).toBe('string');
    expect(typeof meta.lesson).toBe('string');
    expect(m.content).toMatch(/Falsified by:/);
  });
});

describe('syncSeed', () => {
  function fakeClient(result: SaveResult): {
    client: OpenBrainClient;
    saved: BrainMemory[];
  } {
    const saved: BrainMemory[] = [];
    const save = vi.fn(async (m: BrainMemory) => {
      saved.push(m);
      return result;
    });
    // Only `save` is exercised by syncSeed.
    const client = { save } as unknown as OpenBrainClient;
    return { client, saved };
  }

  it('saves every memory and reports an accurate summary on success', async () => {
    const { client, saved } = fakeClient({ saved: true, queued: false, drained: 0 });
    const summary = await syncSeed(client, KNOWLEDGE);

    const total = Object.values(KNOWLEDGE).reduce((n, f) => n + f.entries.length, 0);
    expect(summary.total).toBe(total);
    expect(summary.saved).toBe(total);
    expect(summary.queued).toBe(0);
    expect(saved.length).toBe(total);
    expect(summary.items.every((i) => i.saved)).toBe(true);
  });

  it('reports queued items without throwing when the brain is offline', async () => {
    const { client } = fakeClient({ saved: false, queued: true, drained: 0 });
    const summary = await syncSeed(client, KNOWLEDGE);

    expect(summary.saved).toBe(0);
    expect(summary.queued).toBe(summary.total);
    expect(summary.items.every((i) => i.queued && !i.saved)).toBe(true);
  });
});
