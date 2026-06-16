import { describe, it, expect } from 'vitest';
import {
  HypothesisSchema,
  FalsificationConditionSchema,
  ExperimentSchema,
  CycleStateSchema,
  TierSchema,
  FactEntrySchema,
  ContestedEntrySchema,
  QuantEntrySchema,
} from '../../src/domain/schemas.js';

describe('HypothesisSchema — honesty rule', () => {
  it('rejects a hypothesis with no falsification conditions', () => {
    const result = HypothesisSchema.safeParse({
      statement: 'Coffee improves focus.',
      predicts: 'Reaction time drops after caffeine.',
      falsificationConditions: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at least one falsification condition/i);
    }
  });

  it('rejects a hypothesis missing the falsificationConditions field entirely', () => {
    const result = HypothesisSchema.safeParse({
      statement: 'Coffee improves focus.',
      predicts: 'Reaction time drops after caffeine.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a hypothesis with at least one falsification condition', () => {
    const result = HypothesisSchema.safeParse({
      statement: 'Coffee improves focus.',
      predicts: 'Reaction time drops after caffeine.',
      falsificationConditions: [
        { description: 'No measurable change in reaction time vs. placebo.' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('FalsificationConditionSchema', () => {
  it('requires a non-empty description', () => {
    expect(FalsificationConditionSchema.safeParse({ description: '' }).success).toBe(false);
  });

  it('defaults observable to true', () => {
    const parsed = FalsificationConditionSchema.parse({ description: 'X is observed.' });
    expect(parsed.observable).toBe(true);
  });
});

describe('ExperimentSchema — must be able to fail', () => {
  it('rejects an experiment that cannot fail', () => {
    const result = ExperimentSchema.safeParse({
      decisiveEvidence: ['a measurement'],
      couldFail: false,
    });
    expect(result.success).toBe(false);
  });

  it('accepts an experiment designed so it could fail', () => {
    const result = ExperimentSchema.safeParse({
      decisiveEvidence: ['a measurement'],
      couldFail: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('enums', () => {
  it('CycleStateSchema covers the six cycle states', () => {
    for (const s of ['intake', 'hypothesis', 'experiment', 'analysis', 'review', 'theory']) {
      expect(CycleStateSchema.safeParse(s).success).toBe(true);
    }
    expect(CycleStateSchema.safeParse('done').success).toBe(false);
  });

  it('TierSchema covers the four knowledge tiers', () => {
    for (const t of ['bedrock', 'established', 'contested', 'quantitative']) {
      expect(TierSchema.safeParse(t).success).toBe(true);
    }
    expect(TierSchema.safeParse('opinion').success).toBe(false);
  });
});

describe('knowledge entry schemas', () => {
  it('validates a bedrock/established fact entry', () => {
    const result = FactEntrySchema.safeParse({
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
    expect(result.success).toBe(true);
  });

  it('validates a contested entry with two or more positions', () => {
    const result = ContestedEntrySchema.safeParse({
      id: 'contested.origins.biodiversity',
      question: 'What best explains biodiversity?',
      domain: 'biology/origins',
      positions: [
        {
          label: 'a',
          claim: 'c',
          falsifiable: true,
          falsified_if: 'x',
          falsifiability_status: 'scientific',
        },
        {
          label: 'b',
          claim: 'c2',
          falsifiable: 'depends',
          falsified_if: 'y',
          falsifiability_status: 'conditional',
        },
      ],
      engine_directive: 'present_all_positions_with_falsifiability; do_not_pick_winner',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a contested entry with only one position', () => {
    const result = ContestedEntrySchema.safeParse({
      id: 'x',
      question: 'q',
      domain: 'd',
      positions: [
        { label: 'a', claim: 'c', falsifiable: true, falsified_if: 'x', falsifiability_status: 'scientific' },
      ],
      engine_directive: 'do_not_pick_winner',
    });
    expect(result.success).toBe(false);
  });

  it('validates a quantitative principle entry', () => {
    const result = QuantEntrySchema.safeParse({
      id: 'quant.bayes',
      principle: 'Bayesian updating',
      statement: 'Combine evidence with the prior.',
      formula: 'P(H|E) = P(E|H) * P(H) / P(E)',
      triggers: ['surprising result'],
      failure_guarded: 'ignoring the prior',
    });
    expect(result.success).toBe(true);
  });
});
