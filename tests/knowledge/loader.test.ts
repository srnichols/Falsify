import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  loadAllKnowledge,
  loadKnowledgeFile,
  allEntries,
  TIER_FILES,
} from '../../src/knowledge/loader.js';

const KNOWLEDGE_DIR = resolve(process.cwd(), 'knowledge');

describe('knowledge loader', () => {
  it('loads and validates all tier files', () => {
    const knowledge = loadAllKnowledge(KNOWLEDGE_DIR);
    expect(Object.keys(knowledge).sort()).toEqual([
      'bedrock',
      'contested',
      'established',
      'quantitative',
      'refuted',
    ]);
  });

  it('assigns the documented weights per tier', () => {
    const knowledge = loadAllKnowledge(KNOWLEDGE_DIR);
    expect(knowledge.bedrock.weight).toBe(1.0);
    expect(knowledge.established.weight).toBe(0.8);
    expect(knowledge.contested.weight).toBe(0.5);
    expect(knowledge.quantitative.weight).toBe('cross-cutting');
    expect(knowledge.refuted.weight).toBe(0);
  });

  it('every file declares the tier it is loaded as', () => {
    for (const [tier, file] of Object.entries(TIER_FILES)) {
      const loaded = loadKnowledgeFile(resolve(KNOWLEDGE_DIR, file));
      expect(loaded.tier).toBe(tier);
    }
  });

  it('flattens entries while preserving their tier', () => {
    const knowledge = loadAllKnowledge(KNOWLEDGE_DIR);
    const flat = allEntries(knowledge);
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((e) => 'id' in e.entry)).toBe(true);
    expect(flat.some((e) => e.tier === 'bedrock')).toBe(true);
    expect(flat.some((e) => e.tier === 'contested')).toBe(true);
  });

  it('the refuted graveyard tier carries zero weight and records what killed each claim', () => {
    const knowledge = loadAllKnowledge(KNOWLEDGE_DIR);
    expect(knowledge.refuted.weight).toBe(0);
    for (const entry of knowledge.refuted.entries) {
      expect('falsified_by' in entry).toBe(true);
      expect('lesson' in entry).toBe(true);
    }
  });
});
