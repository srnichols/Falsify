#!/usr/bin/env node
/**
 * `npm run calibrate` — score the labelled cases in `calibration/cases.json`
 * with the active weights (`FALSIFY_WEIGHTS`) and report how well the score
 * separates results that held up from results that were refuted.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { CalibrationFileSchema, evaluateCalibration, weightSensitivity } from '../rules/calibration.js';
import { loadWeights } from '../rules/weights.js';

function main(): void {
  const args = argv.slice(2);
  const sensitivity = args.includes('--sensitivity');
  const file = resolve(process.cwd(), args.find((a) => !a.startsWith('--')) ?? 'calibration/cases.json');
  const { note, cases } = CalibrationFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const weights = loadWeights();
  const result = evaluateCalibration(cases, weights);

  console.log(`Calibration against ${cases.length} cases (${file})`);
  console.log(`Weights: ${JSON.stringify(weights)}\n`);
  for (const c of [...result.cases].sort((a, b) => b.score - a.score)) {
    console.log(`  ${c.score.toFixed(3).padStart(6)}  ${c.evidenceStrength.padEnd(8)} ${c.outcome.padEnd(8)} ${c.id}`);
  }
  console.log(`\nPairwise accuracy (held-up scored above refuted): ${(result.pairwiseAccuracy * 100).toFixed(0)}%`);
  if (result.misordered.length > 0) {
    console.log('Misordered pairs:');
    for (const m of result.misordered) console.log(`  - ${m}`);
  }
  if (sensitivity) printSensitivity(cases);
  console.log(`\nNote: ${note}`);
}

function printSensitivity(cases: Parameters<typeof weightSensitivity>[0]): void {
  const s = weightSensitivity(cases);
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  console.log(`\nWeight sensitivity over ${s.samples} random weightings (consensus kept smallest):`);
  console.log(`  accuracy  min ${pct(s.min)}  median ${pct(s.median)}  max ${pct(s.max)}  (shipped weights: ${pct(s.baseline)})`);
  console.log(`  ${pct(s.shareAtLeastBaseline)} of random weightings did at least as well as the shipped ones`);
  console.log('  statistics weight / evidence weight -> accuracy');
  for (const r of s.ratioSweep) console.log(`    ${String(r.mathPerEvidence).padStart(5)}x  ${pct(r.accuracy)}`);
  console.log('  The cases vary only evidence and statistics, so the other weights are untested by this set.');
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
