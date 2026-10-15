import { describe, it, expect } from 'vitest';
import { assessIntegrity } from '../../src/rules/integrity.js';
import { adjustedPValue, normalizeEvidence } from '../../src/domain/evidence.js';
import type { Evidence } from '../../src/domain/evidence.js';

const search = { description: 'Searched PubMed and the trial registry for caffeine trials', contraryFound: 0 };

function run(
  evidence: Evidence[],
  over: Partial<Parameters<typeof assessIntegrity>[0]> = {},
): ReturnType<typeof assessIntegrity> {
  return assessIntegrity({
    verdict: 'yes',
    items: normalizeEvidence([], evidence, () => false),
    evidenceSearch: search,
    refutedAttempts: 0,
    strict: true,
    ...over,
  });
}

const trial = (over: Partial<Evidence> = {}): Evidence => ({
  observation: 'randomized trial showed faster responses',
  kind: 'experiment',
  source: 'Trial A',
  pValue: 0.004,
  outcomesTested: 1,
  ...over,
});

describe('adjustedPValue', () => {
  it('multiplies by outcomes tested and hypothesis attempts, capped at 1', () => {
    expect(adjustedPValue(0.01, 1, 1)).toBeCloseTo(0.01);
    expect(adjustedPValue(0.01, 5, 2)).toBeCloseTo(0.1);
    expect(adjustedPValue(0.2, 20, 3)).toBe(1);
  });
});

describe('assessIntegrity', () => {
  it('passes a clean, significant, disclosed yes', () => {
    const r = run([trial()]);
    expect(r.refusal).toBeUndefined();
    expect(r.contraryCap).toBe(false);
  });

  it('requires outcomesTested on every p-value in strict mode', () => {
    const r = run([trial({ outcomesTested: undefined })]);
    expect(r.refusal?.rule).toBe('analysis:outcomes-tested-required');
    expect(run([trial({ outcomesTested: undefined })], { strict: false }).refusal).toBeUndefined();
  });

  it('refuses a yes with no search disclosure, or a one-word one', () => {
    expect(run([trial()], { evidenceSearch: undefined }).refusal?.rule).toBe('analysis:search-disclosure-required');
    expect(run([trial()], { evidenceSearch: { description: 'looked', contraryFound: 0 } }).refusal?.rule).toBe(
      'analysis:search-disclosure-required',
    );
  });

  it('requires contrary results to be explained, then caps the strength', () => {
    const unexplained = run([trial()], { evidenceSearch: { ...search, contraryFound: 2 } });
    expect(unexplained.refusal?.rule).toBe('analysis:contrary-evidence-unexplained');
    const explained = run([trial()], {
      evidenceSearch: { ...search, contraryFound: 2, contraryNote: 'Two small trials were null; both underpowered and used lower doses.' },
    });
    expect(explained.refusal).toBeUndefined();
    expect(explained.contraryCap).toBe(true);
  });

  it('refuses a yes that is not significant after counting the outcomes tested (forking paths)', () => {
    const r = run([trial({ pValue: 0.01, outcomesTested: 20 })]);
    expect(r.refusal?.rule).toBe('analysis:not-significant-after-adjustment');
    expect(r.multiplicity?.adjustedPValues[0]?.adjusted).toBe(0.2);
  });

  it('counts earlier refuted hypotheses as additional comparisons (p-hacking across attempts)', () => {
    expect(run([trial({ pValue: 0.02 })], { refutedAttempts: 0 }).refusal).toBeUndefined();
    expect(run([trial({ pValue: 0.02 })], { refutedAttempts: 2 }).refusal?.rule).toBe(
      'analysis:not-significant-after-adjustment',
    );
  });

  it('lets a replication, or a claim of no effect, stand without the adjustment', () => {
    expect(run([trial({ pValue: 0.04, outcomesTested: 20, replicated: true })]).refusal).toBeUndefined();
    expect(run([trial({ pValue: 0.4 })], { nullHypothesisClaim: true }).refusal).toBeUndefined();
  });

  it('flags a yes whose evidence reads as a null result, without refusing', () => {
    const r = run([{ observation: 'there was no significant difference between groups', kind: 'experiment', source: 'Trial B' }]);
    expect(r.refusal).toBeUndefined();
    expect(r.flags.verdictMayContradictEvidence).toBeDefined();
  });

  it('asks for nothing on a no verdict', () => {
    const r = run([trial({ outcomesTested: undefined })], { verdict: 'no', evidenceSearch: undefined });
    expect(r.refusal).toBeUndefined();
  });
});
