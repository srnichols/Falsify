/**
 * A replication model fitted to real outcomes.
 *
 * The first version of the statistical-support signal was a heuristic that rewarded
 * large samples and small p-values. Scored against the Reproducibility Project:
 * Psychology (96 studies with a known replication outcome) it had an AUC of 0.45:
 * no better than chance, because sample size does not predict replication across
 * designs. This module replaces it with a logistic model fitted to those outcomes,
 * using the two original statistics that do carry signal: the p-value and the
 * effect size.
 *
 * Be clear about how much that buys. Cross-validated AUC is about 0.64: original
 * statistics predict replication only modestly. The model is calibrated (its
 * probabilities match the observed replication rate) and scoped to psychology
 * experiments; it is a better-grounded prior, not an oracle.
 */

export interface ReplicationRow {
  /** The original study's p-value. */
  p: number;
  /** The original study's sample size. Kept for analysis; the model does not use it. */
  n: number;
  /** The original study's absolute effect size, as a correlation. */
  r: number;
  replicated: boolean;
}

/** Parse `calibration/data/rpp-replication.csv`. */
export function parseReplicationCsv(text: string): ReplicationRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? '').split(',');
  const at = (name: string): number => cols.indexOf(name);
  const [ip, inn, ir, iy] = [at('p_original'), at('n_original'), at('r_original'), at('replicated')];
  if ([ip, inn, ir, iy].some((i) => i < 0)) {
    throw new Error('replication CSV must have p_original, n_original, r_original and replicated columns');
  }
  return lines
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const f = line.split(',');
      return { p: Number(f[ip]), n: Number(f[inn]), r: Number(f[ir]), replicated: f[iy] === '1' };
    });
}

/** -log10(p), clipped so a vanishing p-value cannot dominate. */
const logP = (p: number, max: number): number => Math.min(max, -Math.log10(Math.max(p, 1e-12)));

/**
 * Fit a ridge-regularised logistic regression by Newton's method.
 *
 * @param X one feature row per observation (no intercept column).
 * @returns `[intercept, ...coefficients]`.
 */
export function fitLogistic(X: readonly (readonly number[])[], y: readonly number[], ridge = 1): number[] {
  const k = (X[0]?.length ?? 0) + 1;
  let w = new Array<number>(k).fill(0);
  for (let iteration = 0; iteration < 100; iteration++) {
    const gradient = new Array<number>(k).fill(0);
    const hessian = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    X.forEach((row, i) => {
      const x = [1, ...row];
      const z = x.reduce((s, v, j) => s + v * w[j]!, 0);
      const prob = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < k; a++) {
        gradient[a]! += (prob - y[i]!) * x[a]!;
        for (let b = 0; b < k; b++) hessian[a]![b]! += prob * (1 - prob) * x[a]! * x[b]!;
      }
    });
    for (let a = 1; a < k; a++) {
      gradient[a]! += ridge * w[a]!;
      hessian[a]![a]! += ridge;
    }
    const step = solve(hessian, gradient);
    w = w.map((v, i) => v - step[i]!);
    if (step.every((s) => Math.abs(s) < 1e-9)) break;
  }
  return w;
}

/** Solve A x = b by Gauss-Jordan elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const factor = M[r]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[r]![j]! -= factor * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Area under the ROC curve: the chance a random positive outscores a random negative. */
export function auc(scores: readonly number[], labels: readonly boolean[]): number {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      if (labels[i] === true && labels[j] === false) {
        pairs++;
        wins += scores[i]! > scores[j]! ? 1 : scores[i] === scores[j] ? 0.5 : 0;
      }
    }
  }
  return pairs === 0 ? 0 : wins / pairs;
}

/** Features for the two-statistic model: -log10 p and effect size r. */
export function modelFeatures(row: Pick<ReplicationRow, 'p' | 'r'>, limits: { maxLogP: number; maxR: number }): number[] {
  return [logP(row.p, limits.maxLogP), Math.min(row.r, limits.maxR)];
}

/** Repeated k-fold cross-validated AUC of the p + effect-size model, with a seeded shuffle. */
export function crossValidatedAuc(
  rows: readonly ReplicationRow[],
  options: { folds?: number; repeats?: number; seed?: number; limits: { maxLogP: number; maxR: number } },
): number {
  const folds = options.folds ?? 5;
  const repeats = options.repeats ?? 20;
  let seed = options.seed ?? 7;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const results: number[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const order = rows.map((_, i) => i).sort(() => random() - 0.5);
    const scores = new Array<number>(rows.length).fill(0);
    for (let fold = 0; fold < folds; fold++) {
      const test = order.filter((_, i) => i % folds === fold);
      const train = order.filter((_, i) => i % folds !== fold);
      const w = fitLogistic(
        train.map((i) => modelFeatures(rows[i]!, options.limits)),
        train.map((i) => (rows[i]!.replicated ? 1 : 0)),
      );
      for (const i of test) {
        const x = modelFeatures(rows[i]!, options.limits);
        scores[i] = 1 / (1 + Math.exp(-(w[0]! + w[1]! * x[0]! + w[2]! * x[1]!)));
      }
    }
    results.push(auc(scores, rows.map((r) => r.replicated)));
  }
  return results.reduce((a, b) => a + b, 0) / results.length;
}

/**
 * The fitted model. Regenerate with `npm run calibrate:replication`; a test checks
 * these constants still match a refit of `calibration/data/rpp-replication.csv`.
 */
export const REPLICATION_MODEL = {
  source: 'Open Science Collaboration 2015, Reproducibility Project: Psychology (n=96 with outcomes)',
  /** [intercept, coefficient on -log10 p, coefficient on effect size r] */
  coefficients: [-2.13, 0.51, 1.0] as readonly [number, number, number],
  /** [intercept, coefficient on -log10 p], for results that report no effect size. */
  pOnlyCoefficients: [-1.9, 0.57] as readonly [number, number],
  /** The training range; inputs are clipped to it rather than extrapolated. */
  limits: { maxLogP: 4, maxR: 0.85 },
  /** Repeated 5-fold cross-validated AUC. Modest: this is a prior, not an oracle. */
  cvAuc: 0.64,
} as const;

/** Convert an effect size to a correlation. Cohen's d becomes r = d / sqrt(d^2 + 4); an r passes through. */
export function effectToR(effectSize: number, metric: 'r' | 'd'): number {
  const magnitude = Math.abs(effectSize);
  return metric === 'd' ? magnitude / Math.sqrt(magnitude * magnitude + 4) : Math.min(1, magnitude);
}

/**
 * Probability that a result with these original statistics replicates, per the model.
 * Without an effect size it falls back to the p-value-only model.
 */
export function replicationProbability(stats: { pValue: number; effectR?: number | undefined }): number {
  const { limits, coefficients, pOnlyCoefficients } = REPLICATION_MODEL;
  const lp = logP(stats.pValue, limits.maxLogP);
  const z =
    stats.effectR === undefined
      ? pOnlyCoefficients[0] + pOnlyCoefficients[1] * lp
      : coefficients[0] + coefficients[1] * lp + coefficients[2] * Math.min(stats.effectR, limits.maxR);
  return 1 / (1 + Math.exp(-z));
}
