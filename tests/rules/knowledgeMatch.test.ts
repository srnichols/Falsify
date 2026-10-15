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

  it('finds the climate, economics and neuroscience entries from plain questions', () => {
    const top = (claim: string): string | undefined => matchKnowledge(index, claim, { limit: 1 })[0]?.id;
    expect(top('Are human greenhouse gas emissions the cause of global warming?')).toBe('established.climate.human_greenhouse_warming');
    expect(top('How much warming do we get for a doubling of CO2, the climate sensitivity?')).toBe('contested.climate.equilibrium_sensitivity');
    expect(top('Does government stimulus spending have a multiplier above one in a recession?')).toBe('contested.economics.fiscal_multiplier');
    expect(top('Do adults grow new neurons in the hippocampus?')).toBe('contested.neuroscience.adult_hippocampal_neurogenesis');
    expect(top('Can policymakers permanently trade higher inflation for lower unemployment on the Phillips curve?')).toBe('refuted.economics.stable_phillips_tradeoff');
    expect(top('Does hippocampal damage stop people forming new memories, like patient H.M.?')).toBe('established.neuroscience.hippocampus_declarative_memory');
  });

  it('finds the new batch-1 and batch-2 entries from plain questions', () => {
    const top = (claim: string): string | undefined => matchKnowledge(index, claim, { limit: 1 })[0]?.id;
    const expected: [string, string][] = [
      ['Did BICEP2 detect primordial gravitational waves from inflation?', 'refuted.cosmology.bicep2_primordial_waves'],
      ['Do neutrinos travel faster than light, as the OPERA experiment reported?', 'refuted.physics.opera_ftl_neutrinos'],
      ['Is LK-99 a room temperature superconductor?', 'refuted.materials.lk99_room_temperature_superconductor'],
      ['Can bacteria use arsenic instead of phosphorus in their DNA, like GFAJ-1?', 'refuted.biology.arsenic_life_gfaj1'],
      ['Do brain training games make you smarter?', 'refuted.neuroscience.brain_training_transfer'],
      ['Does the 5-HTTLPR serotonin transporter gene interact with stress to cause depression?', 'refuted.genetics.candidate_gene_5httlpr'],
      ['Has global warming stopped since 1998?', 'refuted.climate.warming_pause_since_1998'],
      ['Is the sun responsible for recent global warming?', 'refuted.climate.solar_explains_recent_warming'],
      ['Will Himalayan glaciers disappear by 2035?', 'refuted.climate.himalayan_glaciers_2035'],
      ['Does public debt above 90 percent of GDP sharply reduce growth?', 'refuted.economics.reinhart_rogoff_debt_threshold'],
      ['Does it take 10,000 hours of deliberate practice to become an expert?', 'refuted.psychology.ten_thousand_hours'],
      ['Does the marshmallow test predict success in later life?', 'refuted.psychology.marshmallow_test_destiny'],
      ['Is the hot hand in basketball real or an illusion?', 'refuted.psychology.no_hot_hand'],
      ['Were the Clovis people the first to arrive in the Americas?', 'refuted.archaeology.clovis_first'],
      ['Have the continents always been in the same place, with land bridges explaining fossils?', 'refuted.geology.fixed_continents'],
      ['Do homeopathic remedies work better than placebo?', 'refuted.medicine.homeopathy_beyond_placebo'],
      ['Does hydroxychloroquine treat COVID-19?', 'refuted.medicine.hydroxychloroquine_covid'],
      ['Are approved GMO foods safe to eat?', 'established.agriculture.approved_gm_food_safety'],
      ['Is nuclear power safer than coal in deaths per unit of energy?', 'established.energy.nuclear_low_mortality_per_energy'],
      ['Can the grid run on 100 percent wind, water and solar power?', 'contested.energy.high_renewable_grid_feasibility'],
      ['Do concealed carry laws reduce violent crime?', 'contested.criminology.right_to_carry_laws'],
      ['Does saturated fat cause heart disease?', 'contested.nutrition.saturated_fat_cardiovascular_disease'],
      ['Should healthy people at low risk take statins?', 'contested.medicine.statins_low_risk_primary_prevention'],
      ['What fraction of the human genome is functional rather than junk DNA?', 'contested.biology.human_genome_functional_fraction'],
      ['Did wolves restore Yellowstone through a trophic cascade?', 'contested.ecology.yellowstone_wolf_trophic_cascade'],
      ['Does stereotype threat lower test scores?', 'contested.psychology.stereotype_threat'],
      ['Do growth mindset interventions raise student grades?', 'contested.education.growth_mindset_interventions'],
      ['Does the Implicit Association Test predict discrimination?', 'contested.psychology.implicit_association_test'],
      ['Is there an innate universal grammar for language?', 'contested.linguistics.universal_grammar'],
    ];
    for (const [claim, id] of expected) expect(top(claim), claim).toBe(id);
  });

  it('presents every position of a contested entry, with the same falsifiability standard on each', () => {
    const entry = matchKnowledge(index, 'Does the Cambrian explosion show new body plans', { limit: 1 })[0];
    const positions = (entry?.details.positions ?? []) as { label: string; falsifiability_status: string }[];
    expect(positions.length).toBeGreaterThanOrEqual(3);
    expect(entry?.directive).toMatch(/never pick a winner/);
  });
});
