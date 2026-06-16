import { describe, it, expect } from 'vitest';
import { applyQuantitativeLens } from '../../src/rules/quantitative.js';
import type { QuantEntry } from '../../src/domain/types.js';

const PRINCIPLES: QuantEntry[] = [
  {
    id: 'quant.base_rate',
    principle: 'Base-rate neglect',
    statement: 'The base rate dominates the posterior for rare conditions.',
    triggers: ['diagnostic test', 'screening', 'rare event detection'],
    failure_guarded: 'quoting test accuracy while ignoring prevalence',
  },
  {
    id: 'quant.correlation_causation',
    principle: 'Correlation is not causation',
    statement: 'An association does not establish causation.',
    triggers: ['observational study', 'linked to', 'trend comparison'],
    failure_guarded: 'inferring a causal mechanism from a correlation alone',
  },
];

describe('applyQuantitativeLens', () => {
  it('flags a principle when its trigger appears in the text', () => {
    const flags = applyQuantitativeLens(
      'A new diagnostic test reports 99% accuracy for a rare disease.',
      PRINCIPLES,
    );
    expect(flags.map((f) => f.id)).toContain('quant.base_rate');
    const baseRate = flags.find((f) => f.id === 'quant.base_rate');
    expect(baseRate?.matchedTriggers).toContain('diagnostic test');
  });

  it('returns no flags when no triggers match', () => {
    const flags = applyQuantitativeLens('Water boils at 100C at sea level.', PRINCIPLES);
    expect(flags).toEqual([]);
  });

  it('is case-insensitive', () => {
    const flags = applyQuantitativeLens('This OBSERVATIONAL STUDY found X.', PRINCIPLES);
    expect(flags.map((f) => f.id)).toContain('quant.correlation_causation');
  });
});
