import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';
import { buildKnowledgeIndex } from '../../src/rules/knowledgeMatch.js';
import { EmbeddingMatcher, cosine, createOpenAiEmbedder } from '../../src/rules/embeddings.js';
import type { Embedder, EmbeddingFetch } from '../../src/rules/embeddings.js';
import { matchKnowledgeSemantic } from '../../src/rules/semanticMatch.js';

const index = buildKnowledgeIndex(loadAllKnowledge());
const PARAPHRASE = 'Springs stretch in proportion to the load hung on them';
const HOOKE = 'established.physics.hookes_law';

/**
 * A deterministic stand-in for a real model: one dimension per concept, set when the
 * text mentions a word from that concept's family. It "understands" that spring and
 * Hooke's law are about the same thing without sharing any word, as a real model would.
 */
const CONCEPTS: RegExp[] = [
  /elastic|spring|stretch|extend|displacement/i,
  /proportion/i,
  /energy|conserv/i,
  /ulcer|stomach/i,
  /vaccin|autism/i,
];
function fakeVector(text: string): number[] {
  return [...CONCEPTS.map((c) => (c.test(text) ? 1 : 0)), 0.01];
}
function fakeEmbedder(model = 'fake-model'): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model,
    calls,
    embed: async (texts: string[]) => {
      calls.push(texts);
      return texts.map(fakeVector);
    },
  };
}

describe('cosine', () => {
  it('is 1 for identical direction, 0 for orthogonal, and 0 for a zero vector', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('EmbeddingMatcher', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'falsify-emb-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds an entry by meaning when no word is shared, resolving the tier from the YAML', async () => {
    const matcher = new EmbeddingMatcher(index, fakeEmbedder(), { threshold: 0.5 });
    const [top] = await matcher.match(PARAPHRASE);
    expect(top?.id).toBe(HOOKE);
    expect(top?.tier).toBe('established');
    expect(top?.via).toBe('embedding');
    expect(top?.directive).toMatch(/Established theory/);
    expect(top?.directive).toMatch(/not from how many people accept it/);
    expect(top?.details).toHaveProperty('rests_on');
  });

  it('applies the threshold and the limit', async () => {
    const strict = new EmbeddingMatcher(index, fakeEmbedder(), { threshold: 1.01 });
    expect((await strict.match('zzz')).length).toBe(0);
    const loose = new EmbeddingMatcher(index, fakeEmbedder(), { threshold: 0.0 });
    expect((await loose.match(PARAPHRASE, 3)).length).toBe(3);
  });

  it('embeds the corpus once, caches vectors on disk, and re-embeds only what changed', async () => {
    const cachePath = join(dir, 'cache', 'embeddings.json');
    const first = fakeEmbedder();
    await new EmbeddingMatcher(index, first, { cachePath, threshold: 0.5 }).match(PARAPHRASE);
    const corpusCalls = first.calls.filter((c) => c.length > 1);
    expect(corpusCalls.flat().length).toBe(index.entries.length);
    expect(existsSync(cachePath)).toBe(true);

    const second = fakeEmbedder();
    const matcher = new EmbeddingMatcher(index, second, { cachePath, threshold: 0.5 });
    expect((await matcher.match(PARAPHRASE))[0]?.id).toBe(HOOKE);
    expect(second.calls.every((c) => c.length === 1)).toBe(true); // only the query

    const otherModel = fakeEmbedder('another-model');
    await new EmbeddingMatcher(index, otherModel, { cachePath, threshold: 0.5 }).match(PARAPHRASE);
    expect(otherModel.calls.flat().length).toBe(index.entries.length + 1);
  });

  it('does not cache a failure: it recovers once the endpoint is back', async () => {
    let up = false;
    const flaky: Embedder = {
      model: 'flaky',
      embed: async (texts) => {
        if (!up) throw new Error('connection refused');
        return texts.map(fakeVector);
      },
    };
    const matcher = new EmbeddingMatcher(index, flaky, { threshold: 0.5 });
    await expect(matcher.match(PARAPHRASE)).rejects.toThrow('connection refused');
    up = true;
    expect((await matcher.match(PARAPHRASE))[0]?.id).toBe(HOOKE);
  });
});

describe('createOpenAiEmbedder', () => {
  const ok = (vectors: number[][]): ReturnType<EmbeddingFetch> =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ data: vectors.map((embedding) => ({ embedding })) }) });

  it('posts to {baseUrl}/embeddings with the model, input and a bearer key', async () => {
    const fetchImpl = vi.fn<EmbeddingFetch>(() => ok([[1, 2], [3, 4]]));
    const embedder = createOpenAiEmbedder({ baseUrl: 'http://127.0.0.1:11434/v1/', model: 'text-embedding-3-small', apiKey: 'sk-test', fetchImpl });
    expect(await embedder.embed(['a', 'b'])).toEqual([[1, 2], [3, 4]]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/v1/embeddings');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'] });
  });

  it('adds nomic task prefixes by default and none for other models', () => {
    expect(createOpenAiEmbedder({ baseUrl: 'http://x/v1', model: 'nomic-embed-text' })).toMatchObject({ queryPrefix: 'search_query: ', documentPrefix: 'search_document: ' });
    expect(createOpenAiEmbedder({ baseUrl: 'http://x/v1', model: 'text-embedding-3-small' }).queryPrefix).toBeUndefined();
  });

  it('reports a failed request by status only, never echoing the body or key', async () => {
    const fetchImpl: EmbeddingFetch = () =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'bad key sk-LEAK' }) });
    const embedder = createOpenAiEmbedder({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'sk-LEAK', fetchImpl });
    const error = await embedder.embed(['a']).catch((e: unknown) => e as Error);
    expect(error.message).toBe('embedding request failed with status 401');
    expect(error.message).not.toContain('LEAK');
  });

  it('rejects a response that does not hold one vector per input', async () => {
    const fetchImpl: EmbeddingFetch = () => ok([[1, 2]]);
    const embedder = createOpenAiEmbedder({ baseUrl: 'http://x/v1', model: 'm', fetchImpl });
    await expect(embedder.embed(['a', 'b'])).rejects.toThrow(/one vector per input/);
  });
});

describe('matchKnowledgeSemantic with embeddings', () => {
  it('finds a paraphrase through embeddings alone and reports semantic search as used', async () => {
    const embeddings = new EmbeddingMatcher(index, fakeEmbedder(), { threshold: 0.5 });
    const result = await matchKnowledgeSemantic(index, undefined, PARAPHRASE, { embeddings });
    expect(result.matches[0]).toMatchObject({ id: HOOKE, via: 'embedding' });
    expect(result.semantic).toBe('used');
  });

  it('marks an entry found by wording and by embedding as both', async () => {
    const claim = 'Stomach ulcers are caused by stress and spicy food';
    const embeddings = new EmbeddingMatcher(index, fakeEmbedder(), { threshold: 0.5 });
    const result = await matchKnowledgeSemantic(index, undefined, claim, { embeddings });
    expect(result.matches.find((m) => m.id === 'refuted.medicine.ulcer_stress_only')?.via).toBe('both');
  });

  it('degrades to wording matches when the embedding endpoint is down', async () => {
    const down: Embedder = { model: 'down', embed: async () => Promise.reject(new Error('ECONNREFUSED')) };
    const embeddings = new EmbeddingMatcher(index, down);
    const result = await matchKnowledgeSemantic(index, undefined, 'Stomach ulcers are caused by stress and spicy food', { embeddings });
    expect(result.semantic).toBe('unavailable');
    expect(result.matches.length).toBeGreaterThan(0);
  });
});
