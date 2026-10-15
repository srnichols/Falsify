/**
 * The production {@link CycleContext}: sessions, notebook, and (when a key is
 * configured) the Corpus writer, all backed by the on-disk `.falsify` store.
 *
 * Only the real entrypoints (`falsify-mcp`, `falsify-web`) call this. Tests inject
 * their own collaborators so the suite never touches disk or the network.
 */

import { join } from 'node:path';
import { loadConfig, resolveDataDir } from '../config.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import { NotebookStore } from '../memory/notebook.js';
import { OutcomeStore } from '../memory/outcomes.js';
import { EmbeddingMatcher, createOpenAiEmbedder } from '../rules/embeddings.js';
import { createOpenAiJudge } from '../rules/judge.js';
import type { Judge } from '../rules/judge.js';
import { buildKnowledgeIndex } from '../rules/knowledgeMatch.js';
import { loadWeights } from '../rules/weights.js';
import { OpenBrainMcpClient } from '../memory/openbrainMcpClient.js';
import type { CycleContext } from './context.js';
import { DEFAULT_SESSION_DIR, SessionStore } from './session.js';

/** Build the disk-backed context; the Corpus is omitted if OpenBrain is not configured. */
export function createDefaultContext(): CycleContext {
  const ctx: CycleContext = {
    sessions: new SessionStore(DEFAULT_SESSION_DIR),
    notebook: new NotebookStore(),
    outcomes: new OutcomeStore(),
    requireSession: process.env.FALSIFY_REQUIRE_SESSION === '1',
    weights: loadWeights(),
  };
  try {
    const client = new OpenBrainMcpClient(loadConfig());
    ctx.corpus = client;
    ctx.memory = client;
  } catch {
    // No OPENBRAIN_KEY: surviving theories still reach the notebook, just not the corpus.
  }

  const embeddings = createEmbeddingMatcherFromEnv();
  if (embeddings !== undefined) {
    ctx.embeddings = embeddings;
  }
  const judge = createJudgeFromEnv();
  if (judge !== undefined) {
    ctx.judge = judge;
  }
  return ctx;
}

/**
 * An advisory judge model, if `FALSIFY_JUDGE_URL` names an OpenAI-compatible chat
 * endpoint (for example a local Ollama at `http://127.0.0.1:11434/v1`). Off by
 * default: nothing is sent anywhere unless you set it. See `rules/judge.ts`.
 */
export function createJudgeFromEnv(env: NodeJS.ProcessEnv = process.env): Judge | undefined {
  const baseUrl = env.FALSIFY_JUDGE_URL;
  if (baseUrl === undefined || baseUrl === '') return undefined;
  return createOpenAiJudge({
    baseUrl,
    model: env.FALSIFY_JUDGE_MODEL ?? 'qwen2.5:32b',
    apiKey: env.FALSIFY_JUDGE_KEY,
  });
}

/**
 * An embedding matcher, if `FALSIFY_EMBEDDINGS_URL` names an OpenAI-compatible
 * endpoint (for example a local Ollama at `http://127.0.0.1:11434/v1`). Off by
 * default: nothing is sent anywhere unless you set it.
 */
export function createEmbeddingMatcherFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingMatcher | undefined {
  const baseUrl = env.FALSIFY_EMBEDDINGS_URL;
  if (baseUrl === undefined || baseUrl === '') return undefined;
  try {
    const model = env.FALSIFY_EMBEDDINGS_MODEL ?? 'nomic-embed-text';
    const threshold = env.FALSIFY_EMBEDDINGS_THRESHOLD !== undefined ? Number(env.FALSIFY_EMBEDDINGS_THRESHOLD) : undefined;
    const embedder = createOpenAiEmbedder({ baseUrl, model, apiKey: env.FALSIFY_EMBEDDINGS_KEY });
    const index = buildKnowledgeIndex(loadAllKnowledge());
    return new EmbeddingMatcher(index, embedder, {
      cachePath: join(resolveDataDir(env), `embeddings-${model.replace(/[^A-Za-z0-9._-]/g, '_')}.json`),
      ...(threshold !== undefined && Number.isFinite(threshold) ? { threshold } : {}),
    });
  } catch {
    return undefined;
  }
}
