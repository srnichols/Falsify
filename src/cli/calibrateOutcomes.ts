#!/usr/bin/env node
/**
 * `npm run calibrate:outcomes` — compare the claim scores of recorded theories
 * with the outcomes later logged via `falsify_outcome`.
 */

import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { OutcomeStore } from '../memory/outcomes.js';
import { evaluateOutcomes } from '../rules/outcomeCalibration.js';

function main(): void {
  const report = evaluateOutcomes(new OutcomeStore().current());
  console.log(`Recorded outcomes: ${report.total} (held-up ${report.heldUp}, refuted ${report.refuted}, inconclusive ${report.inconclusive})`);
  console.log('Held-up / refuted by evidence strength at confirmation:');
  for (const s of report.byStrength) console.log(`  ${s.strength.padEnd(9)} ${s.heldUp} / ${s.refuted}`);
  if (report.pairwiseAccuracy !== undefined) {
    console.log(`\nPairwise accuracy (held-up scored above refuted): ${(report.pairwiseAccuracy * 100).toFixed(0)}%`);
  }
  console.log(`\n${report.message}`);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
