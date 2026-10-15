import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REPLICATION_MODEL,
  auc,
  effectToR,
  fitLogistic,
  parseReplicationCsv,
  replicationProbability,
} from '../../src/rules/replicationModel.js';
import { refit } from '../../src/cli/calibrateReplication.js';
import { statisticalSupport, evidenceQuality } from '../../src/domain/evidence.js';
import type { ResolvedEvidence } from '../../src/domain/evidence.js';

const csv = readFileSync(resolve(process.cwd(), 'calibration', 'data', 'rpp-replication.csv'), 'utf8');

describe('the replication model is grounded in real outcomes', () => {
  const fit = refit(csv);

  it('is fitted to the shipped Reproducibility Project data', () => {
    expect(fit.rows).toBe(96);
    expect(fit.replicatedRate).toBeCloseTo(0.39, 1);
  });

  it('has committed coefficients that match a refit of that data', () => {
    REPLICATION_MODEL.coefficients.forEach((c, i) => expect(c).toBeCloseTo(fit.coefficients[i]!, 1));
    REPLICATION_MODEL.pOnlyCoefficients.forEach((c, i) => expect(c).toBeCloseTo(fit.pOnlyCoefficients[i]!, 1));
  });

  it('predicts held-out replication better than chance, and says honestly that it is modest', () => {
    expect(fit.cvAuc).toBeGreaterThan(0.58);
    expect(fit.cvAuc).toBeLessThan(0.8);
    expect(REPLICATION_MODEL.cvAuc).toBeCloseTo(fit.cvAuc, 1);
  });

  it('is calibrated: the mean predicted probability matches the observed replication rate', () => {
    const rows = parseReplicationCsv(csv);
    const mean = rows.reduce((s, r) => s + replicationProbability({ pValue: r.p, effectR: r.r }), 0) / rows.length;
    expect(Math.abs(mean - fit.replicatedRate)).toBeLessThan(0.05);
  });
});

describe('replicationProbability', () => {
  it('rises as the p-value falls and as the effect grows, and stays a probability', () => {
    expect(replicationProbability({ pValue: 0.001, effectR: 0.4 })).toBeGreaterThan(
      replicationProbability({ pValue: 0.04, effectR: 0.4 }),
    );
    expect(replicationProbability({ pValue: 0.01, effectR: 0.6 })).toBeGreaterThan(
      replicationProbability({ pValue: 0.01, effectR: 0.1 }),
    );
    for (const p of [0, 1e-12, 0.001, 0.05, 1]) {
      const v = replicationProbability({ pValue: p, effectR: 0.3 });
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not extrapolate: a vanishing p-value or a huge effect is clipped to the training range', () => {
    expect(replicationProbability({ pValue: 1e-30, effectR: 0.3 })).toBe(replicationProbability({ pValue: 1e-4, effectR: 0.3 }));
    expect(replicationProbability({ pValue: 0.01, effectR: 5 })).toBe(replicationProbability({ pValue: 0.01, effectR: 0.85 }));
  });

  it('falls back to the p-only model with no effect size', () => {
    const [b0, b1] = REPLICATION_MODEL.pOnlyCoefficients;
    expect(replicationProbability({ pValue: 0.01 })).toBeCloseTo(1 / (1 + Math.exp(-(b0 + b1 * 2))), 10);
  });
});

describe('effectToR', () => {
  it('converts Cohen d to r and passes r through', () => {
    expect(effectToR(0.8, 'd')).toBeCloseTo(0.8 / Math.sqrt(0.64 + 4), 10);
    expect(effectToR(-0.4, 'r')).toBe(0.4);
  });
});

describe('statistical support uses the model, not sample size', () => {
  const stat = (over: Partial<ResolvedEvidence>): ResolvedEvidence => ({ observation: 'x y', kind: 'statistical', ...over });

  it('ignores sample size, which did not predict replication across designs', () => {
    const small = statisticalSupport([stat({ pValue: 0.01, effectSize: 0.3, sampleSize: 20 })]);
    const large = statisticalSupport([stat({ pValue: 0.01, effectSize: 0.3, sampleSize: 20000 })]);
    expect(large).toBe(small);
    expect(evidenceQuality({ observation: 'x y', kind: 'experiment', sampleSize: 20000 })).toBe(
      evidenceQuality({ observation: 'x y', kind: 'experiment' }),
    );
  });

  it('is zero without a p-value, 0.9 once replicated, and the model probability otherwise', () => {
    expect(statisticalSupport([stat({ effectSize: 0.5, sampleSize: 500 })])).toBe(0);
    expect(statisticalSupport([stat({ pValue: 0.04, replicated: true })])).toBe(0.9);
    expect(statisticalSupport([stat({ pValue: 0.01, effectSize: 0.3 })])).toBeCloseTo(
      replicationProbability({ pValue: 0.01, effectR: 0.3 }),
      10,
    );
  });

  it('reads an effect size above 1 as Cohen d unless told otherwise', () => {
    expect(statisticalSupport([stat({ pValue: 0.01, effectSize: 1.2 })])).toBeCloseTo(
      replicationProbability({ pValue: 0.01, effectR: effectToR(1.2, 'd') }),
      10,
    );
    expect(statisticalSupport([stat({ pValue: 0.01, effectSize: 0.5, effectMetric: 'd' })])).toBeCloseTo(
      replicationProbability({ pValue: 0.01, effectR: effectToR(0.5, 'd') }),
      10,
    );
  });
});

describe('fitLogistic and auc', () => {
  it('recovers a separable signal and scores it above chance', () => {
    const X = [[0], [1], [2], [3], [4], [5]];
    const y = [0, 0, 0, 1, 1, 1];
    const w = fitLogistic(X, y, 0.1);
    expect(w[1]).toBeGreaterThan(0);
    expect(auc(X.map((r) => r[0]!), y.map((v) => v === 1))).toBe(1);
    expect(auc([1, 1, 1, 1], [true, false, true, false])).toBe(0.5);
  });
});
