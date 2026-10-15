#!/usr/bin/env node
/**
 * `npm run calibrate:replication` — refit the replication model to the real
 * Reproducibility Project: Psychology outcomes and report how well it predicts
 * them out of sample.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  REPLICATION_MODEL,
  auc,
  crossValidatedAuc,
  fitLogistic,
  modelFeatures,
  parseReplicationCsv,
} from '../rules/replicationModel.js';

/** Refit both models on every row. Pure, so the test can reuse it. */
export function refit(text: string): {
  rows: number;
  replicatedRate: number;
  coefficients: number[];
  pOnlyCoefficients: number[];
  inSampleAuc: number;
  cvAuc: number;
} {
  const rows = parseReplicationCsv(text);
  const limits = REPLICATION_MODEL.limits;
  const y = rows.map((r) => (r.replicated ? 1 : 0));
  const coefficients = fitLogistic(rows.map((r) => modelFeatures(r, limits)), y);
  const pOnlyCoefficients = fitLogistic(rows.map((r) => [modelFeatures(r, limits)[0]!]), y);
  const scores = rows.map((r) => {
    const x = modelFeatures(r, limits);
    return coefficients[0]! + coefficients[1]! * x[0]! + coefficients[2]! * x[1]!;
  });
  return {
    rows: rows.length,
    replicatedRate: y.reduce<number>((a, b) => a + b, 0) / rows.length,
    coefficients,
    pOnlyCoefficients,
    inSampleAuc: auc(scores, rows.map((r) => r.replicated)),
    cvAuc: crossValidatedAuc(rows, { limits }),
  };
}

function main(): void {
  const file = resolve(process.cwd(), argv[2] ?? 'calibration/data/rpp-replication.csv');
  const fit = refit(readFileSync(file, 'utf8'));
  const fmt = (v: number[]): string => `[${v.map((x) => x.toFixed(2)).join(', ')}]`;

  console.log(`Replication model refit on ${fit.rows} studies (${(fit.replicatedRate * 100).toFixed(0)}% replicated)`);
  console.log(`  p + effect size : ${fmt(fit.coefficients)}   (committed: ${fmt([...REPLICATION_MODEL.coefficients])})`);
  console.log(`  p only          : ${fmt(fit.pOnlyCoefficients)}   (committed: ${fmt([...REPLICATION_MODEL.pOnlyCoefficients])})`);
  console.log(`  in-sample AUC   : ${fit.inSampleAuc.toFixed(3)}`);
  console.log(`  cross-validated : ${fit.cvAuc.toFixed(3)}   (committed: ${REPLICATION_MODEL.cvAuc})`);
  console.log('\nAUC 0.5 is chance. Original statistics predict replication only modestly; this is a prior, not an oracle.');
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
