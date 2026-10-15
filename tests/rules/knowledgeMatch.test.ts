import { describe, it, expect } from 'vitest';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { buildKnowledgeIndex, matchKnowledge, tokenize } from '../../src/rules/knowledgeMatch.js';

const index = buildKnowledgeIndex(loadAllKnowledge());

describe('tokenize', () => {
  it('drops stopwords and short tokens and stems plurals', () => {
    const tokens = tokenize('The particles are falling in the lab');
    expect(tokens.has('particle')).toBe(true);
    expect(tokens.has('fall')).toBe(true);
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('lab')).toBe(true);
  });
});

describe('matchKnowledge', () => {
  it('indexes every tier except the Quantitative lens', () => {
    expect(index.entries.length).toBeGreaterThan(50);
    expect(index.entries.some((e) => e.tier === 'quantitative')).toBe(false);
  });

  it('finds a refuted lookalike and tells the caller what killed it', () => {
    const [top] = matchKnowledge(index, 'Stomach ulcers are caused by stress and spicy food');
    expect(top?.tier).toBe('refuted');
    expect(top?.id).toBe('refuted.medicine.ulcer_stress_only');
    expect(top?.details.falsified_by).toBeTruthy();
    expect(top?.directive).toMatch(/refuted/i);
  });

  it('puts the burden of proof on a claim that touches a Bedrock law', () => {
    const matches = matchKnowledge(index, 'Energy can be created from nothing in a closed system');
    const bedrock = matches.find((m) => m.tier === 'bedrock');
    expect(bedrock?.id).toBe('bedrock.energy.conservation');
    expect(bedrock?.directive).toMatch(/cannot override|contrary evidence/i);
  });

  it('presents every side of a contested question without picking a winner', () => {
    const contested = matchKnowledge(index, 'What explains the origin of life on Earth?').find(
      (m) => m.tier === 'contested',
    );
    expect(contested).toBeDefined();
    expect((contested?.details.positions as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(contested?.directive).toMatch(/never pick a winner/i);
  });

  it('returns nothing for an unrelated or empty claim, and respects the limit', () => {
    expect(matchKnowledge(index, 'zzz qqq')).toEqual([]);
    expect(matchKnowledge(index, '')).toEqual([]);
    expect(matchKnowledge(index, 'energy momentum conservation light speed', { limit: 2 }).length).toBeLessThanOrEqual(2);
  });
});
