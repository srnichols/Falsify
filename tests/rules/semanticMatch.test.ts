import { describe, it, expect } from 'vitest';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { buildKnowledgeIndex } from '../../src/rules/knowledgeMatch.js';
import { matchKnowledgeSemantic } from '../../src/rules/semanticMatch.js';
import { opRelated } from '../../src/cycle/related.js';
import type { MemoryReader } from '../../src/memory/openbrainClient.js';

const index = buildKnowledgeIndex(loadAllKnowledge());
const PARAPHRASE = 'Heavier objects fall faster than lighter ones when there is no air';

const reader = (hits: unknown[]): MemoryReader => ({ recall: async () => hits });

describe('matchKnowledgeSemantic', () => {
  it('misses a paraphrase lexically but finds it through semantic recall, resolving tier from the YAML', async () => {
    const lexicalOnly = await matchKnowledgeSemantic(index, undefined, PARAPHRASE);
    expect(lexicalOnly.matches.some((m) => m.id === 'bedrock.equivalence.principle')).toBe(false);
    expect(lexicalOnly.semantic).toBe('unavailable');

    const hit = {
      content: 'Equivalence principle text\n\n— Falsify knowledge seed —\ntier: WRONG_TIER_FROM_BACKEND\nsource_id: bedrock.equivalence.principle',
      similarity: 0.88,
    };
    const result = await matchKnowledgeSemantic(index, reader([hit]), PARAPHRASE);
    const found = result.matches.find((m) => m.id === 'bedrock.equivalence.principle');
    expect(found?.via).toBe('semantic');
    expect(found?.tier).toBe('bedrock');
    expect(found?.score).toBe(0.88);
    expect(found?.directive).toMatch(/Bedrock law/);
    expect(result.semantic).toBe('used');
  });

  it('marks an entry found both ways and keeps the higher score', async () => {
    const claim = 'Energy can be created from nothing in a closed system';
    const hit = { content: 'x\nsource_id: bedrock.energy.conservation', similarity: 0.95 };
    const result = await matchKnowledgeSemantic(index, reader([hit]), claim);
    const found = result.matches.find((m) => m.id === 'bedrock.energy.conservation');
    expect(found?.via).toBe('both');
    expect(found?.score).toBe(0.95);
  });

  it('ignores hits that name no known entry and falls back to rank scores', async () => {
    const hits = [{ content: 'no id here' }, { content: 'source_id: nope.missing' }, 'source_id: bedrock.equivalence.principle'];
    const result = await matchKnowledgeSemantic(index, reader(hits), PARAPHRASE);
    expect(result.matches.map((m) => m.id)).toEqual(['bedrock.equivalence.principle']);
    expect(result.matches[0]?.score).toBeGreaterThanOrEqual(0.4);
  });

  it('degrades to lexical results when the reader fails or finds nothing', async () => {
    const failing: MemoryReader = { recall: async () => Promise.reject(new Error('brain offline x-brain-key=LEAK')) };
    const failed = await matchKnowledgeSemantic(index, failing, 'Stomach ulcers are caused by stress');
    expect(failed.semantic).toBe('unavailable');
    expect(failed.matches.length).toBeGreaterThan(0);
    expect(JSON.stringify(failed)).not.toContain('LEAK');

    const empty = await matchKnowledgeSemantic(index, reader([]), 'zzz qqq');
    expect(empty).toEqual({ matches: [], semantic: 'no-hits' });
  });
});

describe('opRelated', () => {
  it('returns matches with a semantic status, and explains an empty result', async () => {
    const found = await opRelated({ claim: 'Stomach ulcers are caused by stress and spicy food' }, { knowledge: index });
    expect(found.kind).toBe('ok');
    if (found.kind === 'ok') {
      expect((found.payload.matches as unknown[]).length).toBeGreaterThan(0);
      expect(found.payload.semantic).toBe('unavailable');
    }

    const none = await opRelated({ claim: 'zzz qqq' }, { knowledge: index });
    if (none.kind === 'ok') {
      expect(none.payload.count).toBe(0);
      expect(String(none.payload.message)).toMatch(/not absence/i);
    }
  });

  it('uses the context memory reader', async () => {
    const hit = { content: 'x\nsource_id: bedrock.equivalence.principle', similarity: 0.9 };
    const result = await opRelated({ claim: PARAPHRASE }, { knowledge: index, memory: reader([hit]) });
    if (result.kind === 'ok') {
      expect(result.payload.semantic).toBe('used');
    } else {
      throw new Error('expected ok');
    }
  });
});
