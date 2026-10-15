import { describe, it, expect } from 'vitest';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { buildKnowledgeIndex, matchKnowledge } from '../../src/rules/knowledgeMatch.js';

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
