/**
 * The **Outcome log** — what later happened to a theory Falsify recorded.
 *
 * Finishing the cycle records that a process was followed, not that the claim was
 * right. This log is the only place a recorded theory can later be labelled "held
 * up" or "refuted" by what actually happened. Each outcome keeps a snapshot of the
 * claim score the theory had when it was confirmed, so the labelled set can be used
 * to check whether the score predicts anything (see `rules/outcomeCalibration.ts`).
 *
 * Append-only JSONL like the notebook; a later outcome for the same session
 * supersedes an earlier one when folded, and the earlier line is kept.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_PROJECT, resolveDataDir } from '../config.js';

export const DEFAULT_OUTCOME_DIR = join(resolveDataDir(), 'outcomes');

export const OutcomeKindSchema = z.enum(['held-up', 'refuted', 'inconclusive']);
export type OutcomeKind = z.infer<typeof OutcomeKindSchema>;

export const OutcomeRecordSchema = z.object({
  sessionId: z.string().min(1),
  outcome: OutcomeKindSchema,
  /** What happened, and how the caller knows. */
  basis: z.string().min(1),
  /** A DOI or URL for the later evidence, if any. */
  reference: z.string().optional(),
  recordedAt: z.string(),
  /** The theory and its score when it was confirmed. */
  snapshot: z.object({
    statement: z.string(),
    nonConsensusScore: z.number().optional(),
    evidenceStrength: z.enum(['weak', 'moderate', 'strong']).optional(),
    hypothesesTried: z.number().int().positive(),
  }),
});
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

export class OutcomeStore {
  private readonly file: string;

  constructor(dir: string = DEFAULT_OUTCOME_DIR, project: string = DEFAULT_PROJECT) {
    this.file = join(dir, `${project}.jsonl`);
  }

  record(entry: OutcomeRecord): void {
    mkdirSync(resolve(this.file, '..'), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  /** Every line ever written, oldest first. */
  history(): OutcomeRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    const out: OutcomeRecord[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed = OutcomeRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // A torn or hand-edited line is skipped; the rest of the log still counts.
      }
    }
    return out;
  }

  /** The latest outcome per session. */
  current(): OutcomeRecord[] {
    const latest = new Map<string, OutcomeRecord>();
    for (const r of this.history()) latest.set(r.sessionId, r);
    return [...latest.values()];
  }
}
