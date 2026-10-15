import { describe, it, expect } from 'vitest';
import {
  evidenceQuality,
  normalizeEvidence,
  statisticalSupport,
  strengthLabel,
} from '../../src/domain/evidence.js';
import type { ResolvedEvidence } from '../../src/domain/evidence.js';

const appeal = (text: string): boolean => /experts agree|settled/i.test(text);

describe('normalizeEvidence', () => {
  it('turns free text into observations and structured items keep their fields', () => {
    const items = normalizeEvidence(
      ['reaction time fell'],
      [{ observation: 'randomized trial', sampleSize: 400, pValue: 0.01, source: 'Trial A' }],
      appeal,
    );
    expect(items[0]).toMatchObject({ observation: 'reaction time fell', kind: 'observation' });
    expect(items[1]).toMatchObject({ kind: 'statistical', sampleSize: 400, source: 'Trial A' });
  });

  it('cannot launder consensus into an observation by relabelling it', () => {
    const [item] = normalizeEvidence([], [{ observation: 'experts agree it works', kind: 'experiment', source: 'Panel' }], appeal);
    expect(item?.kind).toBe('consensus');
  });
});

describe('evidenceQuality', () => {
  const item = (over: Partial<ResolvedEvidence>): ResolvedEvidence => ({
    observation: 'reaction time fell',
    kind: 'observation',
    ...over,
  });

  it('gives consensus no weight and anecdotes almost none', () => {
    expect(evidenceQuality(item({ kind: 'consensus' }))).toBe(0);
    expect(evidenceQuality(item({ kind: 'anecdote' }))).toBeLessThan(0.2);
  });

  it('rewards provenance, sample size and replication, capped at 1', () => {
    const plain = evidenceQuality(item({ kind: 'experiment' }));
    const strong = evidenceQuality(
      item({ kind: 'experiment', source: 'Trial A', sampleSize: 500, replicated: true }),
    );
    expect(strong).toBeGreaterThan(plain);
    expect(strong).toBeLessThanOrEqual(1);
  });
});

describe('statisticalSupport', () => {
  it('is zero when nothing reports statistics: absence is not support', () => {
    expect(statisticalSupport([{ observation: 'reaction time fell', kind: 'observation' }])).toBe(0);
  });

  it('grows with sample size and a significant result, and ignores consensus', () => {
    const small = statisticalSupport([{ observation: 'a', kind: 'statistical', sampleSize: 20, pValue: 0.2 }]);
    const large = statisticalSupport([{ observation: 'a', kind: 'statistical', sampleSize: 1000, pValue: 0.001, effectSize: 0.4 }]);
    expect(large).toBeGreaterThan(small);
    expect(statisticalSupport([{ observation: 'a', kind: 'consensus', sampleSize: 1000, pValue: 0.001 }])).toBe(0);
  });
});

describe('strengthLabel', () => {
  it('labels by direct-evidence signal', () => {
    expect(strengthLabel(0.1)).toBe('weak');
    expect(strengthLabel(0.5)).toBe('moderate');
    expect(strengthLabel(0.9)).toBe('strong');
  });
});
