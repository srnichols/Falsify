/**
 * Embedding-based matching — real semantic similarity, with no OpenBrain needed.
 *
 * Any OpenAI-compatible `/embeddings` endpoint works. A local Ollama server
 * (`http://127.0.0.1:11434/v1`, model `nomic-embed-text`) keeps claims on your
 * machine; a hosted endpoint sends the claim text, and the knowledge entries' text
 * once, to that provider. Nothing is sent unless `FALSIFY_EMBEDDINGS_URL` is set.
 *
 * The backend only supplies vectors. Which entries exist, their tiers, wording and
 * directives still come from the local YAML, so the corpus remains the single
 * source of truth. Entry vectors are cached on disk, keyed by a hash of the entry
 * text, so a restart or an unchanged corpus costs no calls.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KnowledgeIndex, KnowledgeMatch } from './knowledgeMatch.js';
import { matchFromId } from './knowledgeMatch.js';

/** Turns texts into vectors. */
export interface Embedder {
  /** Identifies the model; a cache built with a different model is discarded. */
  readonly model: string;
  /** Some models (e.g. nomic-embed-text) are trained with task prefixes and rank far better with them. */
  readonly queryPrefix?: string;
  readonly documentPrefix?: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** The slice of `fetch` the embedder needs, so tests can inject a fake. */
export type EmbeddingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpenAiEmbedderOptions {
  /** Base URL up to and including `/v1`, e.g. `http://127.0.0.1:11434/v1`. */
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  /** Prefix for claims being searched. Defaults to nomic's `search_query: ` for nomic models. */
  queryPrefix?: string | undefined;
  /** Prefix for knowledge entries being indexed. Defaults to nomic's `search_document: ` for nomic models. */
  documentPrefix?: string | undefined;
  fetchImpl?: EmbeddingFetch | undefined;
  timeoutMs?: number | undefined;
}

/** An embedder for any OpenAI-compatible `/embeddings` endpoint (Ollama, OpenAI, LM Studio, ...). */
export function createOpenAiEmbedder(options: OpenAiEmbedderOptions): Embedder {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as EmbeddingFetch);
  const url = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  const nomic = /nomic/i.test(options.model);
  const queryPrefix = options.queryPrefix ?? (nomic ? 'search_query: ' : undefined);
  const documentPrefix = options.documentPrefix ?? (nomic ? 'search_document: ' : undefined);
  return {
    model: options.model,
    ...(queryPrefix !== undefined ? { queryPrefix } : {}),
    ...(documentPrefix !== undefined ? { documentPrefix } : {}),
    async embed(texts: string[]): Promise<number[][]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey !== undefined ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: options.model, input: texts }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // Status only: never echo a response body that might carry a credential.
          throw new Error(`embedding request failed with status ${res.status}`);
        }
        const data = ((await res.json()) as { data?: { embedding?: unknown }[] }).data;
        const vectors = (data ?? []).map((d) => d.embedding);
        if (vectors.length !== texts.length || !vectors.every((v): v is number[] => Array.isArray(v) && v.length > 0)) {
          throw new Error('embedding response did not contain one vector per input');
        }
        return vectors;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Cosine similarity in [-1, 1]; 0 for a zero vector. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

interface VectorCache {
  model: string;
  vectors: Record<string, { hash: string; vector: number[] }>;
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
const BATCH = 32;

export interface EmbeddingMatcherOptions {
  /** Where to cache entry vectors. Omit to keep them in memory only. */
  cachePath?: string | undefined;
  /** Minimum cosine similarity to report. Model-dependent; 0.65 suits nomic-embed-text, whose scores are compressed. */
  threshold?: number | undefined;
}

/** Matches claims to knowledge entries by embedding similarity. */
export class EmbeddingMatcher {
  private vectors: Map<string, number[]> | undefined;
  private loading: Promise<Map<string, number[]>> | undefined;
  private readonly threshold: number;

  constructor(
    private readonly index: KnowledgeIndex,
    private readonly embedder: Embedder,
    private readonly options: EmbeddingMatcherOptions = {},
  ) {
    this.threshold = options.threshold ?? 0.65;
  }

  /** Embed any entries not already cached. Safe to call repeatedly. */
  private ready(): Promise<Map<string, number[]>> {
    this.loading ??= this.build().catch((error: unknown) => {
      // Do not cache a failure: the endpoint may simply not be up yet.
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  private async build(): Promise<Map<string, number[]>> {
    const cache = this.readCache();
    const vectors = new Map<string, number[]>();
    const missing: { id: string; hash: string; text: string }[] = [];
    for (const { entry, text } of this.index.entries) {
      const input = `${this.embedder.documentPrefix ?? ''}${text}`;
      const hash = sha(input);
      const cached = cache.vectors[entry.id];
      if (cached !== undefined && cached.hash === hash) vectors.set(entry.id, cached.vector);
      else missing.push({ id: entry.id, hash, text: input });
    }

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const embedded = await this.embedder.embed(batch.map((m) => m.text));
      batch.forEach((m, k) => {
        vectors.set(m.id, embedded[k]!);
        cache.vectors[m.id] = { hash: m.hash, vector: embedded[k]! };
      });
    }
    if (missing.length > 0) this.writeCache(cache);
    return vectors;
  }

  private readCache(): VectorCache {
    const empty: VectorCache = { model: this.embedder.model, vectors: {} };
    if (this.options.cachePath === undefined) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.options.cachePath, 'utf8')) as VectorCache;
      return parsed.model === this.embedder.model ? parsed : empty;
    } catch {
      return empty;
    }
  }

  private writeCache(cache: VectorCache): void {
    if (this.options.cachePath === undefined) return;
    try {
      mkdirSync(dirname(this.options.cachePath), { recursive: true });
      writeFileSync(this.options.cachePath, JSON.stringify(cache), 'utf8');
    } catch {
      // A cache that cannot be written only costs a re-embed next time.
    }
  }

  /**
   * The entries closest in meaning to a claim, best first.
   *
   * @throws if the embedder fails; callers degrade to the other matchers.
   */
  async match(text: string, limit = 5): Promise<KnowledgeMatch[]> {
    const vectors = await this.ready();
    const [query] = await this.embedder.embed([`${this.embedder.queryPrefix ?? ''}${text}`]);
    if (query === undefined) return [];

    const scored: { id: string; score: number }[] = [];
    for (const [id, vector] of vectors) {
      const score = cosine(query, vector);
      if (score >= this.threshold) scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const matches: KnowledgeMatch[] = [];
    for (const { id, score } of scored.slice(0, limit)) {
      const found = matchFromId(this.index, id, score, 'embedding');
      if (found !== undefined) matches.push(found);
    }
    return matches;
  }
}
