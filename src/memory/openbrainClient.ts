/**
 * OpenBrain client — the Corpus memory backend (DESIGN.md §5).
 *
 * Two commitments are enforced here:
 *
 *  1. **Graceful degradation.** If the brain is unreachable, a `save` is written
 *     to a local on-disk queue (`.falsify/queue/*.json`) instead of being lost or
 *     blocking the cycle. The queue is drained on the next successful save.
 *  2. **The key never leaks.** The `x-brain-key` value is sent only in the
 *     request header and is never interpolated into an error message, thrown
 *     value, or log line.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { FalsifyConfig } from '../config.js';

/**
 * Minimal fetch shape — abstracted so the client does not depend on the DOM lib
 * and so tests can inject a mock.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** A memory to persist in the Corpus tier. */
export interface BrainMemory {
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/** A semantic recall query. */
export interface RecallQuery {
  query: string;
  limit?: number;
  threshold?: number;
}

/** Outcome of a save attempt. */
export interface SaveResult {
  saved: boolean;
  queued: boolean;
  drained: number;
}

export interface OpenBrainClientOptions {
  /** Directory for the offline queue. Defaults to `.falsify/queue`. */
  queueDir?: string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

/** Thrown on a non-2xx response. Carries only the status — never the key. */
export class BrainHttpError extends Error {
  constructor(public readonly status: number) {
    super(`OpenBrain request failed with status ${status}.`);
    this.name = 'BrainHttpError';
  }
}

export const DEFAULT_QUEUE_DIR = resolve(process.cwd(), '.falsify', 'queue');

export class OpenBrainClient {
  private readonly queueDir: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: FalsifyConfig,
    options: OpenBrainClientOptions = {},
  ) {
    this.queueDir = options.queueDir ?? DEFAULT_QUEUE_DIR;
    const injected = options.fetchImpl;
    this.fetchImpl = injected ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('No fetch implementation available; pass options.fetchImpl.');
    }
  }

  /**
   * Persist a memory. On network failure the payload is queued locally and
   * `{ saved:false, queued:true }` is returned — the caller is never blocked. On
   * success, any previously-queued payloads are drained first.
   */
  async save(memory: BrainMemory): Promise<SaveResult> {
    const payload = { ...memory, project: this.config.project };
    try {
      await this.post('/memories', payload);
    } catch {
      this.enqueue(payload);
      return { saved: false, queued: true, drained: 0 };
    }
    const drained = await this.drainQueue();
    return { saved: true, queued: false, drained };
  }

  /** Semantic recall. Throws on failure (recall has no offline fallback). */
  async recall(query: RecallQuery): Promise<unknown[]> {
    const body = {
      query: query.query,
      project: this.config.project,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.threshold !== undefined ? { threshold: query.threshold } : {}),
    };
    const json = (await this.post('/memories/search', body)) as { results?: unknown[] } | unknown[];
    if (Array.isArray(json)) return json;
    return json.results ?? [];
  }

  /** Number of payloads currently waiting in the offline queue. */
  pendingCount(): number {
    return this.queueFiles().length;
  }

  /** POST a JSON body. The key travels only in the header, never in an error. */
  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(this.config.brainRestBase + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-brain-key': this.config.brainKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new BrainHttpError(res.status);
    }
    return res.json();
  }

  private enqueue(payload: unknown): void {
    mkdirSync(this.queueDir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
    writeFileSync(join(this.queueDir, name), JSON.stringify(payload), 'utf8');
  }

  private queueFiles(): string[] {
    try {
      return readdirSync(this.queueDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Drain queued payloads in FIFO order. Stops at the first failure, leaving the
   * remaining payloads for a later attempt.
   *
   * @returns how many payloads were successfully drained.
   */
  private async drainQueue(): Promise<number> {
    let drained = 0;
    for (const file of this.queueFiles()) {
      const full = join(this.queueDir, file);
      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        rmSync(full, { force: true }); // unreadable entry — discard
        continue;
      }
      try {
        await this.post('/memories', payload);
      } catch {
        break; // still offline — leave this and the rest queued
      }
      rmSync(full, { force: true });
      drained += 1;
    }
    return drained;
  }
}
