import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalibrationFileSchema, evaluateCalibration } from '../../src/rules/calibration.js';

const { cases } = CalibrationFileSchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), 'calibration', 'cases.json'), 'utf8')),
);

/**
 * Pairs the score is known to get wrong. A sourced null experiment from 1887 has no
 * p-value to earn statistical credit, while an unreplicated 6-sigma result does.
 * Listing them keeps the limit visible; the test fails if a NEW pair is misordered.
 */
const KNOWN_LIMITS = [
  'michelson-morley-1887 should outscore opera-ftl-2011',
  'michelson-morley-1887 should outscore bem-precognition-2011',
];

describe('claim-score calibration against labelled cases', () => {
  const result = evaluateCalibration(cases);

  it('separates results that held up from results that were refuted, apart from the known limits', () => {
    expect(result.pairwiseAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(result.misordered.filter((m) => !KNOWN_LIMITS.includes(m))).toEqual([]);
  });

  it('never calls an unreplicated result strong', () => {
    const unreplicatedStrong = cases
      .filter((c) => c.evidence.every((e) => e.replicated !== true))
      .map((c) => result.cases.find((r) => r.id === c.id))
      .filter((r) => r?.evidenceStrength === 'strong');
    expect(unreplicatedStrong).toEqual([]);
  });

  it('calls the replicated large studies strong and unreplicated bare observations weak', () => {
    const strength = (id: string): string | undefined => result.cases.find((c) => c.id === id)?.evidenceStrength;
    expect(strength('smoking-lung-cancer')).toBe('strong');
    expect(strength('h-pylori-ulcers')).toBe('strong');
    expect(strength('cold-fusion-1989')).toBe('weak');
    expect(strength('polywater-1960s')).toBe('weak');
  });

  it('is a fair set: both outcomes are represented and every case cites a basis', () => {
    expect(cases.filter((c) => c.outcome === 'held-up').length).toBeGreaterThanOrEqual(4);
    expect(cases.filter((c) => c.outcome === 'refuted').length).toBeGreaterThanOrEqual(4);
    expect(cases.every((c) => c.basis.length > 10)).toBe(true);
  });
});
