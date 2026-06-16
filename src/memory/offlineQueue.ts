/**
 * A tiny on-disk FIFO queue for memory payloads (DESIGN.md §5, "graceful
 * degradation").
 *
 * When the brain is unreachable a payload is written here instead of being lost
 * or blocking the cycle; it is replayed on the next successful save. The queue
 * is deliberately transport-agnostic — it stores whatever opaque payload the
 * caller hands it and replays it through a caller-supplied `send` function.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export class OfflineQueue {
  constructor(private readonly dir: string) {}

  /** Append a payload to the queue. */
  enqueue(payload: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
    writeFileSync(join(this.dir, name), JSON.stringify(payload), 'utf8');
  }

  /** Number of payloads currently waiting. */
  count(): number {
    return this.files().length;
  }

  /**
   * Replay queued payloads in FIFO order through `send`. Stops at the first
   * failure, leaving that payload and the rest queued for a later attempt.
   *
   * @returns how many payloads were successfully drained.
   */
  async drain(send: (payload: unknown) => Promise<void>): Promise<number> {
    let drained = 0;
    for (const file of this.files()) {
      const full = join(this.dir, file);
      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        rmSync(full, { force: true }); // unreadable entry — discard
        continue;
      }
      try {
        await send(payload);
      } catch {
        break; // still offline — leave this and the rest queued
      }
      rmSync(full, { force: true });
      drained += 1;
    }
    return drained;
  }

  private files(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }
}
