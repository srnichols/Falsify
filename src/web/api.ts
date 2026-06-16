/**
 * The Falsify HTTP/JSON API — a transport-neutral request handler over the core
 * operations (Phase-3 plan, Slice 3).
 *
 * {@link handleRequest} is deliberately pure: it takes a method, a path, an
 * already-parsed body, and the injected dependencies, and returns a status +
 * JSON. It imports no `node:http`, so it is unit-testable without a socket and
 * the web server is a thin wrapper over it.
 *
 * The discipline is NOT re-implemented here: every cycle route delegates to the
 * same `op*` function the MCP transport calls, so neither transport can weaken a
 * rule the other enforces. Request schemas are kept permissive about the honesty
 * fields (e.g. a hypothesis's falsification condition) so a violation surfaces as
 * the named `honesty:*`/`analysis:*` error (HTTP 422), not a generic 400.
 */

import { z } from 'zod';
import { CycleStateSchema } from '../domain/schemas.js';
import type { QuantEntry } from '../domain/types.js';
import {
  opIntake,
  opHypothesize,
  opExperiment,
  opAnalyze,
  opReview,
  opRecall,
} from '../cycle/operations.js';
import type { OpResult } from '../cycle/operations.js';
import type { MemoryReader } from '../memory/openbrainClient.js';
import { NotebookStore } from '../memory/notebook.js';

/** Resources injected into the web handler. All optional; defaulted lazily. */
export interface WebDeps {
  /** Memory backend for `/api/recall`. Defaulted to OpenBrain only if used. */
  memory?: MemoryReader;
  /** Quantitative-tier principles for the lens. Defaulted from the seed. */
  quantPrinciples?: QuantEntry[];
  /** The visible-mistakes notebook. Defaulted to the on-disk `.falsify` store. */
  notebook?: NotebookStore;
}

/** A handler outcome: an HTTP status and a JSON body. */
export interface ApiResponse {
  status: number;
  json: Record<string, unknown>;
}

const intakeBody = z.object({
  question: z.string().min(1),
  cycleState: CycleStateSchema.optional(),
});

const hypothesizeBody = z.object({
  statement: z.string().min(1),
  predicts: z.string().min(1),
  falsificationConditions: z
    .array(z.object({ description: z.string(), observable: z.boolean().optional() }))
    .optional(),
  cycleState: CycleStateSchema.optional(),
});

const experimentBody = z.object({
  decisiveEvidence: z.array(z.string()).optional(),
  couldFail: z.boolean(),
  cycleState: CycleStateSchema.optional(),
});

const analyzeBody = z.object({
  verdict: z.enum(['yes', 'no']),
  evidenceCited: z.array(z.string()).optional(),
  cycleState: CycleStateSchema.optional(),
});

const reviewBody = z.object({
  q1Methods: z.string(),
  q2Hypothesis: z.string(),
  q3Theory: z.string(),
  outcome: z.enum(['revise', 'confirm']),
  cycleState: CycleStateSchema.optional(),
});

const recallBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
});

const notebookRecordBody = z.object({
  kind: z.string().min(1),
  text: z.string().min(1),
});

const notebookStrikeBody = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});

function fromOp(result: OpResult): ApiResponse {
  return result.kind === 'ok'
    ? { status: 200, json: result.payload }
    : { status: 422, json: { error: result.error, rule: result.rule, guidance: result.guidance } };
}

function badRequest(message: string): ApiResponse {
  return {
    status: 400,
    json: {
      error: message,
      rule: 'request:invalid-body',
      guidance: 'Fix the request body to match the endpoint schema and try again.',
    },
  };
}

function notFound(): ApiResponse {
  return {
    status: 404,
    json: {
      error: 'No such endpoint.',
      rule: 'request:not-found',
      guidance: 'Use one of the POST /api/* cycle routes or the /api/notebook routes.',
    },
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): { value: T } | { response: ApiResponse } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join('.') || '(body)';
    return { response: badRequest(`Invalid request body at '${where}': ${first?.message ?? 'invalid'}.`) };
  }
  return { value: result.data };
}

/**
 * Dispatch a request to the matching core operation or notebook action.
 *
 * @param method the HTTP method (e.g. `'POST'`).
 * @param path the request path without query string (e.g. `'/api/intake'`).
 * @param body the already-parsed JSON body (or `undefined`).
 * @param deps injected resources (memory, quant lens, notebook).
 */
export async function handleRequest(
  method: string,
  path: string,
  body: unknown,
  deps: WebDeps = {},
): Promise<ApiResponse> {
  const route = `${method.toUpperCase()} ${path}`;

  switch (route) {
    case 'POST /api/intake': {
      const p = parse(intakeBody, body);
      return 'response' in p ? p.response : fromOp(opIntake(p.value));
    }
    case 'POST /api/hypothesize': {
      const p = parse(hypothesizeBody, body);
      return 'response' in p ? p.response : fromOp(opHypothesize(p.value, deps.quantPrinciples));
    }
    case 'POST /api/experiment': {
      const p = parse(experimentBody, body);
      return 'response' in p ? p.response : fromOp(opExperiment(p.value));
    }
    case 'POST /api/analyze': {
      const p = parse(analyzeBody, body);
      return 'response' in p ? p.response : fromOp(opAnalyze(p.value));
    }
    case 'POST /api/review': {
      const p = parse(reviewBody, body);
      return 'response' in p ? p.response : fromOp(opReview(p.value));
    }
    case 'POST /api/recall': {
      const p = parse(recallBody, body);
      return 'response' in p ? p.response : fromOp(await opRecall(p.value, deps.memory));
    }
    case 'GET /api/notebook': {
      const store = deps.notebook ?? new NotebookStore();
      return { status: 200, json: { items: store.list() } };
    }
    case 'POST /api/notebook': {
      const p = parse(notebookRecordBody, body);
      if ('response' in p) return p.response;
      const store = deps.notebook ?? new NotebookStore();
      return { status: 200, json: { item: store.record(p.value) } };
    }
    case 'POST /api/notebook/strike': {
      const p = parse(notebookStrikeBody, body);
      if ('response' in p) return p.response;
      const store = deps.notebook ?? new NotebookStore();
      const struck = store.strikeThrough(p.value.id, p.value.reason);
      return { status: 200, json: { struck } };
    }
    default:
      return notFound();
  }
}
