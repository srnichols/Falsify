/**
 * Cycle sessions — server-side memory of where an inquiry stands.
 *
 * Without a session, the caller supplies `cycleState` on every call, so "no Yes
 * without Review" holds only if the caller is honest. A session makes the state
 * authoritative: it is advanced only by successful operations, remembers the
 * locked hypothesis (a pre-registration — the prediction is fixed before any
 * analysis), and records whether a genuine "yes" verdict was ever reached, so a
 * Theory can only be confirmed after one.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { CycleState } from '../domain/types.js';

/** Default on-disk location for sessions, mirroring `.falsify/notebook`. */
export const DEFAULT_SESSION_DIR = resolve(process.cwd(), '.falsify', 'sessions');

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A hypothesis as locked into the session before any analysis. */
export interface LockedHypothesis {
  statement: string;
  predicts: string;
  falsificationConditions: { description: string; observable: boolean }[];
  claimType?: string;
  assumptions?: string[];
  /** ISO timestamp at which the prediction was fixed. */
  lockedAt: string;
  /** 0 for the original; incremented for each revision after a refutation. */
  revision: number;
  revisionNote?: string;
}

/** One entry in a session's audit trail. */
export interface SessionEvent {
  at: string;
  event: string;
  from: CycleState;
  to: CycleState;
  summary: string;
}

/** The full, persisted state of one inquiry. */
export interface SessionRecord {
  id: string;
  question: string;
  state: CycleState;
  createdAt: string;
  updatedAt: string;
  hypothesis?: LockedHypothesis;
  /** Hypotheses refuted by earlier loops, oldest first. */
  refuted: LockedHypothesis[];
  experiment?: { decisiveEvidence: string[] };
  analysis?: { verdict: 'yes' | 'no'; evidenceCited: string[]; at: string };
  /** True after a review chose "revise": the next hypothesis must justify itself. */
  pendingRevision: boolean;
  history: SessionEvent[];
}

/**
 * Holds sessions in memory and, when given a directory, mirrors each to
 * `<dir>/<id>.json` so an inquiry survives a server restart.
 */
export class SessionStore {
  private readonly cache = new Map<string, SessionRecord>();

  constructor(private readonly dir?: string) {}

  /** Start a new inquiry at the Hypothesis state (Intake already passed). */
  create(question: string): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      question,
      state: 'hypothesis',
      createdAt: now,
      updatedAt: now,
      refuted: [],
      pendingRevision: false,
      history: [
        { at: now, event: 'hypothesize', from: 'intake', to: 'hypothesis', summary: 'Question judged falsifiable at Intake.' },
      ],
    };
    this.save(record);
    return record;
  }

  /** Look up a session by id; `undefined` if unknown or malformed. */
  get(id: string): SessionRecord | undefined {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    if (this.dir === undefined || !SESSION_ID_PATTERN.test(id)) {
      return undefined;
    }
    try {
      const record = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as SessionRecord;
      this.cache.set(id, record);
      return record;
    } catch {
      return undefined;
    }
  }

  /** Persist the record (and refresh its `updatedAt`). */
  save(record: SessionRecord): void {
    record.updatedAt = new Date().toISOString();
    this.cache.set(record.id, record);
    if (this.dir !== undefined) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
    }
  }
}
