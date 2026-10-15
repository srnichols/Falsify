#!/usr/bin/env node
/**
 * `npm run calibrate:judge` — measure the optional judge model against labelled
 * cases (`calibration/judge-cases.json`), next to the keyword baseline.
 *
 * Set `FALSIFY_JUDGE_URL` (and optionally `FALSIFY_JUDGE_MODEL`). This is how you
 * learn what the judge's advice is worth before trusting any of it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createJudgeFromEnv } from '../cycle/defaultContext.js';
import { isConsensusAppeal, opIntake } from '../cycle/operations.js';
import { judgeConsensusAppeal, judgeFalsifiability, judgeSupport } from '../rules/judge.js';
import type { Judge } from '../rules/judge.js';

const CasesSchema = z.object({
  note: z.string(),
  falsifiability: z.array(z.object({ claim: z.string(), falsifiable: z.boolean(), note: z.string().optional() })),
  consensus: z.array(z.object({ text: z.string(), appeal: z.boolean(), note: z.string().optional() })),
  support: z.array(
    z.object({ doi: z.string(), title: z.string(), abstract: z.string(), observation: z.string(), supports: z.enum(['yes', 'no']) }),
  ),
});

export interface TaskResult {
  task: string;
  total: number;
  baselineCorrect: number | undefined;
  judgeCorrect: number;
  /** Cases the judge answered "unclear" or failed on: counted as wrong, shown separately. */
  judgeUnclear: number;
  misses: string[];
}

const pct = (n: number, d: number): string => `${((n / d) * 100).toFixed(0)}%`;

/** Run every task against a judge. Exported so a test can drive it with a fake. */
export async function evaluateJudge(judge: Judge, cases: z.infer<typeof CasesSchema>): Promise<TaskResult[]> {
  const results: TaskResult[] = [];

  const fals: TaskResult = { task: 'falsifiability', total: cases.falsifiability.length, baselineCorrect: 0, judgeCorrect: 0, judgeUnclear: 0, misses: [] };
  for (const c of cases.falsifiability) {
    const intake = opIntake({ question: c.claim });
    const baseline = intake.kind === 'ok' && intake.payload.falsifiable === true;
    if (baseline === c.falsifiable) fals.baselineCorrect = (fals.baselineCorrect ?? 0) + 1;
    const j = await judgeFalsifiability(judge, c.claim);
    if (j.falsifiable === 'unclear') fals.judgeUnclear++;
    else if ((j.falsifiable === 'yes') === c.falsifiable) fals.judgeCorrect++;
    else fals.misses.push(`judge said ${j.falsifiable}: ${c.claim}`);
  }
  results.push(fals);

  const cons: TaskResult = { task: 'consensus appeal', total: cases.consensus.length, baselineCorrect: 0, judgeCorrect: 0, judgeUnclear: 0, misses: [] };
  for (const c of cases.consensus) {
    if (isConsensusAppeal(c.text) === c.appeal) cons.baselineCorrect = (cons.baselineCorrect ?? 0) + 1;
    const j = await judgeConsensusAppeal(judge, c.text);
    if (j.appeal === 'unclear') cons.judgeUnclear++;
    else if (j.appeal === c.appeal) cons.judgeCorrect++;
    else cons.misses.push(`judge said ${j.appeal}: ${c.text}`);
  }
  results.push(cons);

  const sup: TaskResult = { task: 'paper supports observation', total: cases.support.length, baselineCorrect: undefined, judgeCorrect: 0, judgeUnclear: 0, misses: [] };
  for (const c of cases.support) {
    const j = await judgeSupport(judge, c.observation, c.abstract);
    if (j.supports === 'unclear') sup.judgeUnclear++;
    else if (j.supports === c.supports) sup.judgeCorrect++;
    else sup.misses.push(`judge said ${j.supports}: ${c.observation}`);
  }
  results.push(sup);
  return results;
}

async function main(): Promise<void> {
  const judge = createJudgeFromEnv();
  if (judge === undefined) {
    console.error('Set FALSIFY_JUDGE_URL (for example http://127.0.0.1:11434/v1) and FALSIFY_JUDGE_MODEL.');
    process.exitCode = 1;
    return;
  }
  const file = resolve(process.cwd(), argv[2] ?? 'calibration/judge-cases.json');
  const cases = CasesSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

  console.log(`Judge ${judge.model} against ${file}\n`);
  for (const r of await evaluateJudge(judge, cases)) {
    const baseline = r.baselineCorrect === undefined ? '     n/a' : pct(r.baselineCorrect, r.total).padStart(8);
    console.log(
      `${r.task.padEnd(28)} keyword baseline ${baseline}   judge ${pct(r.judgeCorrect, r.total).padStart(4)} correct, ${r.judgeUnclear} unclear, ${r.total - r.judgeCorrect - r.judgeUnclear} wrong (of ${r.total})`,
    );
    for (const miss of r.misses) console.log(`    - ${miss}`);
  }
  console.log(`\nNote: ${cases.note}`);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
