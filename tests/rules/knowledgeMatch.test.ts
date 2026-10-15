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

  it('finds plain-language paraphrases through curated keywords', () => {
    const cases: [string, string][] = [
      ['Heavier objects fall faster than lighter ones when there is no air', 'bedrock.equivalence.principle'],
      ['Vaccines cause autism in children', 'refuted.medicine.vaccines_autism'],
      ['Bad air from swamps causes cholera', 'refuted.medicine.miasma'],
      ['Visual learners learn better when taught visually', 'refuted.education.learning_styles'],
      ['A free energy machine that runs forever', 'refuted.engineering.perpetual_motion'],
    ];
    for (const [claim, id] of cases) {
      expect(matchKnowledge(index, claim)[0]?.id, claim).toBe(id);
    }
  });

  it('returns nothing for an unrelated or empty claim, and respects the limit', () => {
    expect(matchKnowledge(index, 'zzz qqq')).toEqual([]);
    expect(matchKnowledge(index, '')).toEqual([]);
    expect(matchKnowledge(index, 'energy momentum conservation light speed', { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it('does not match on generic claim language (a real host run matched caffeine to RL circuits)', () => {
    const claim =
      'A 200mg oral caffeine dose lowers mean reaction time in healthy adults compared with placebo, with faster responses after the dose';
    expect(matchKnowledge(index, claim)).toEqual([]);
  });

  it('finds the design-debate entries from either side of each question', () => {
    const top = (claim: string): string | undefined => matchKnowledge(index, claim, { limit: 1 })[0]?.id;
    const cambrian = 'contested.paleontology.cambrian_body_plans';
    const folds = 'contested.biochemistry.functional_protein_rarity';
    const info = 'contested.biology.information_in_dna';

    expect(top('Does the Cambrian explosion show that Darwinian mechanisms cannot produce new body plans in the time available?')).toBe(cambrian);
    expect(top('Does the fossil record of the Cambrian show that gradual common descent can account for new body plans?')).toBe(cambrian);
    expect(top('Functional protein folds are too rare in sequence space for unguided mutation to find new ones')).toBe(folds);
    expect(top('Could a random mutation search find a functional protein fold among all possible sequences within the age of the Earth?')).toBe(folds);
    expect(top('Does evolution create new genetic information?')).toBe(info);
    expect(top('Is specified complexity a reliable empirical indicator of intelligent design?')).toBe(info);
  });

  it('presents every position of a contested entry, with the same falsifiability standard on each', () => {
    const entry = matchKnowledge(index, 'Does the Cambrian explosion show new body plans', { limit: 1 })[0];
    const positions = (entry?.details.positions ?? []) as { label: string; falsifiability_status: string }[];
    expect(positions.length).toBeGreaterThanOrEqual(3);
    expect(entry?.directive).toMatch(/never pick a winner/);
  });
});
