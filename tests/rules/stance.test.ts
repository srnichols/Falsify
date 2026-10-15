import { describe, it, expect } from 'vitest';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { buildKnowledgeIndex, matchKnowledge, withStance } from '../../src/rules/knowledgeMatch.js';
import type { KnowledgeMatch } from '../../src/rules/knowledgeMatch.js';

const index = buildKnowledgeIndex(loadAllKnowledge());

const find = (text: string, id: string) => matchKnowledge(index, text, { limit: 10 }).find((m) => m.id === id);

describe('stance-aware matching', () => {
  it('does not tell a claim that denies a refuted idea that it resembles that idea', () => {
    const denies = find('Routine childhood vaccination does not cause autism', 'refuted.medicine.vaccines_autism');
    expect(denies?.stance).toBe('denies');
    expect(denies?.directive).toMatch(/denies an idea that was already refuted/);
    expect(denies?.directive).not.toMatch(/resembles a claim that was already refuted/);
  });

  it('still warns a claim that asserts the refuted idea', () => {
    const asserts = find('Routine childhood vaccination causes autism', 'refuted.medicine.vaccines_autism');
    expect(asserts?.stance).toBe('asserts');
    expect(asserts?.directive).toMatch(/resembles a claim that was already refuted/);
  });

  it('treats the two wordings differently but keeps both in view', () => {
    const a = find('Vaccination does not cause autism', 'refuted.medicine.vaccines_autism');
    const b = find('Vaccination causes autism', 'refuted.medicine.vaccines_autism');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.stance).not.toBe(b?.stance);
  });

  it('keeps the burden-of-proof directive when it cannot tell, rather than guessing agreement', () => {
    const m = find('Energy can be created from nothing in a closed system', 'bedrock.energy.conservation');
    expect(m).toBeDefined();
    expect(m?.directive).toMatch(/Bedrock law/);
  });

  it('marks a claim with a contrast clause unclear', () => {
    const m = find('Vaccination does not cause autism but carries other risks', 'refuted.medicine.vaccines_autism');
    if (m !== undefined) expect(m.stance).toBe('unclear');
  });
});

describe('stance on matches found by meaning alone', () => {
  const claim = 'Does the Cambrian explosion show that Darwinian mechanisms cannot produce new body plans in the time available?';
  const vitalism = (over: Partial<KnowledgeMatch>): KnowledgeMatch => ({
    tier: 'refuted',
    id: 'refuted.biology.vitalism',
    title: 'Living organisms possess a special non-physical "vital force" that is required to explain life\'s chemistry.',
    score: 0.663,
    directive: 'This resembles a claim that was already refuted. Say what is different this time.',
    details: {},
    via: 'semantic',
    ...over,
  });

  it('does not tell a Cambrian claim it agrees with the refutation of vitalism (a real false positive)', () => {
    const m = withStance(claim, vitalism({}));
    expect(m.stance).toBe('unclear');
    expect(m.directive).toMatch(/may be about something else/);
    expect(m.directive).not.toMatch(/agrees with the record/);
    expect(m.directive).toMatch(/already refuted/);
  });

  it('treats an embedding-only match the same way', () => {
    expect(withStance(claim, vitalism({ via: 'embedding' })).stance).toBe('unclear');
  });

  it('still reads stance for a strong semantic match, and for any lexical or combined match', () => {
    expect(withStance(claim, vitalism({ score: 0.82 })).stance).toBe('denies');
    expect(withStance(claim, vitalism({ via: 'lexical', score: 0.4 })).stance).toBe('denies');
    expect(withStance(claim, vitalism({ via: 'both', score: 0.5 })).stance).toBe('denies');
  });

  it('does not touch a Contested or Established directive on a weak match beyond the warning', () => {
    const m = withStance(claim, { ...vitalism({}), tier: 'established', directive: 'This touches Established theory.' });
    expect(m.stance).toBe('unclear');
    expect(m.directive).toMatch(/This touches Established theory\.$/);
  });
});
