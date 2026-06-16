/**
 * The **Notebook tier** (DESIGN.md §5) — the durable, *visible-mistakes* store.
 *
 * A wrong hypothesis is never deleted. It is struck through and dated and kept
 * legible, so the falsification loop stays visible: "Mistakes stay in the
 * notebook." The backing file is an append-only JSONL event log
 * (`.falsify/notebook/<project>.jsonl`); the struck state of an entry is derived
 * by folding the log on `list`, so history is immutable.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { DEFAULT_PROJECT } from '../config.js';

/** Default on-disk location for the notebook, mirroring `.falsify/queue`. */
export const DEFAULT_NOTEBOOK_DIR = resolve(process.cwd(), '.falsify', 'notebook');

/** An appended "new entry" event. */
interface EntryEvent {
  type: 'entry';
  id: string;
  kind: string;
  text: string;
  createdAt: string;
}

/** An appended "strike this entry through" event — never removes the entry. */
interface StrikeEvent {
  type: 'strike';
  refId: string;
  reason: string;
  struckAt: string;
}

type NotebookEvent = EntryEvent | StrikeEvent;

/** The struck marker on a folded notebook item. */
export interface StruckMarker {
  reason: string;
  struckAt: string;
}

/** A notebook entry as seen after folding the event log. */
export interface NotebookItem {
  id: string;
  kind: string;
  text: string;
  createdAt: string;
  struck?: StruckMarker;
}

/** Input to {@link NotebookStore.record}. */
export interface NotebookInput {
  kind: string;
  text: string;
}

/**
 * An append-only notebook. Entries are recorded and later struck through; they
 * are never edited or deleted.
 */
export class NotebookStore {
  private readonly file: string;

  constructor(dir: string = DEFAULT_NOTEBOOK_DIR, project: string = DEFAULT_PROJECT) {
    this.file = join(dir, `${project}.jsonl`);
  }

  /** Append a new entry and return its folded item. */
  record(input: NotebookInput): NotebookItem {
    const event: EntryEvent = {
      type: 'entry',
      id: randomUUID(),
      kind: input.kind,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    this.append(event);
    return { id: event.id, kind: event.kind, text: event.text, createdAt: event.createdAt };
  }

  /**
   * Strike an existing entry through with a dated reason. Appends a strike
   * event — the original entry line stays in the file untouched.
   *
   * @returns `true` when the entry existed and was struck; `false` (a no-op)
   *   when no entry has that id.
   */
  strikeThrough(id: string, reason: string): boolean {
    const known = this.readEvents().some((e) => e.type === 'entry' && e.id === id);
    if (!known) {
      return false;
    }
    const event: StrikeEvent = {
      type: 'strike',
      refId: id,
      reason,
      struckAt: new Date().toISOString(),
    };
    this.append(event);
    return true;
  }

  /** Fold the event log into the current set of entries, struck and unstruck. */
  list(): NotebookItem[] {
    const items = new Map<string, NotebookItem>();
    const order: string[] = [];
    for (const event of this.readEvents()) {
      if (event.type === 'entry') {
        if (!items.has(event.id)) {
          order.push(event.id);
        }
        items.set(event.id, {
          id: event.id,
          kind: event.kind,
          text: event.text,
          createdAt: event.createdAt,
        });
      } else {
        const item = items.get(event.refId);
        if (item) {
          item.struck = { reason: event.reason, struckAt: event.struckAt };
        }
      }
    }
    return order.map((id) => items.get(id)!).filter((item): item is NotebookItem => item !== undefined);
  }

  private append(event: NotebookEvent): void {
    mkdirSync(resolve(this.file, '..'), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private readEvents(): NotebookEvent[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    const events: NotebookEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }
      try {
        events.push(JSON.parse(trimmed) as NotebookEvent);
      } catch {
        // skip a corrupt line rather than crash the whole notebook
      }
    }
    return events;
  }
}
