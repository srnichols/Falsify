/**
 * Transport-neutral cycle operations — the single source of truth for Falsify's
 * discipline (DESIGN.md §3, §4).
 *
 * Phase 2 put the honesty rules, cycle routing, and quantitative lens inside the
 * MCP tool handlers. Phase 3 adds a second transport (the web UI), and two
 * transports must never be able to drift — one weakening a rule the other
 * enforces. So the logic lives here, returning a neutral {@link OpResult}, and
 * every transport (MCP `CallToolResult`, web JSON) is a thin mapper over it.
 *
 * This module imports no transport. It is the core.
 */

import {
  AnalysisSchema,
  ExperimentSchema,
  HypothesisSchema,
} from '../domain/schemas.js';
import type { CycleState, QuantEntry } from '../domain/types.js';
import { legalEvents, transition, CycleTransitionError } from './stateMachine.js';
import type { CycleEvent } from './stateMachine.js';
import { applyQuantitativeLens } from '../rules/quantitative.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import { loadConfig } from '../config.js';
import { OpenBrainMcpClient } from '../memory/openbrainMcpClient.js';
import type { MemoryReader, RecallQuery } from '../memory/openbrainClient.js';

/** A transport-neutral operation result. */
export type OpResult =
  | { kind: 'ok'; payload: Record<string, unknown> }
  | { kind: 'error'; error: string; rule: string; guidance: string };

/** The challenge Falsify returns to any appeal to authority (DESIGN.md §3). */
export const CONSENSUS_CHALLENGE =
  'Which experiment showed that, and could it have come out the other way?';

/** Phrases that signal an appeal to consensus/authority rather than evidence. */
const CONSENSUS_APPEAL_PATTERNS: readonly RegExp[] = [
  /\bthe science is settled\b/i,
  /\bsettled science\b/i,
  /\bscientists agree\b/i,
  /\bexperts agree\b/i,
  /\bscientific consensus\b/i,
  /\beveryone knows\b/i,
  /\bno one (?:seriously )?(?:disputes|doubts)\b/i,
  /\b\d{1,3}\s?% of (?:scientists|experts|doctors)\b/i,
];

/** Phrases that signal a normative / value claim — outside the method. */
const NORMATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:should|ought to|must)\b/i,
  /\b(?:morally|ethically) (?:right|wrong)\b/i,
  /\bis (?:better|worse|best|the best) than?\b/i,
  /\b(?:beautiful|ugly|good|evil|immoral)\b/i,
];

/** Phrases that signal a definitional / tautological claim — unfalsifiable. */
const DEFINITIONAL_PATTERNS: readonly RegExp[] = [/\bby definition\b/i, /\bis defined as\b/i];

function matches(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function okResult(payload: Record<string, unknown>): OpResult {
  return { kind: 'ok', payload };
}

function errorResult(error: string, rule: string, guidance: string): OpResult {
  return { kind: 'error', error, rule, guidance };
}

/** An ok result that also reports where the cycle now stands. */
function withState(payload: Record<string, unknown>, state: CycleState): OpResult {
  return okResult({ ...payload, cycleState: state, legalNext: legalEvents(state) });
}

/**
 * Apply a cycle event, converting an illegal transition into a structured error
 * result instead of a thrown exception.
 */
function advance(state: CycleState, event: CycleEvent): { next: CycleState } | { err: OpResult } {
  try {
    return { next: transition(state, event) };
  } catch (err) {
    if (err instanceof CycleTransitionError) {
      return {
        err: errorResult(
          err.message,
          'cycle:illegal-transition',
          `From state '${state}' the legal events are: ${legalEvents(state).join(', ') || '(none — terminal)'}.`,
        ),
      };
    }
    throw err;
  }
}

/** Lazily-loaded, memoized default quantitative principles (from the seed). */
let cachedPrinciples: QuantEntry[] | undefined;
function getDefaultQuantPrinciples(): QuantEntry[] {
  if (cachedPrinciples === undefined) {
    cachedPrinciples = loadAllKnowledge().quantitative.entries as QuantEntry[];
  }
  return cachedPrinciples;
}

/** Lazily-constructed, memoized live reader (only built if actually used). */
let cachedReader: MemoryReader | undefined;
function getDefaultReader(): MemoryReader {
  if (cachedReader === undefined) {
    cachedReader = new OpenBrainMcpClient(loadConfig());
  }
  return cachedReader;
}

// --- Operations -----------------------------------------------------------

/** Intake input. */
export interface IntakeInput {
  question: string;
  cycleState?: CycleState | undefined;
}

/**
 * Decide whether a question is falsifiable (Popper's line). Flags normative,
 * definitional, or consensus-appeal phrasings; a consensus appeal is answered
 * with the essay's challenge, never deference. A falsifiable claim advances
 * Intake → Hypothesis.
 */
export function opIntake(input: IntakeInput): OpResult {
  const { question } = input;
  const state: CycleState = input.cycleState ?? 'intake';

  const consensusAppeal = matches(question, CONSENSUS_APPEAL_PATTERNS);
  const normative = matches(question, NORMATIVE_PATTERNS);
  const definitional = matches(question, DEFINITIONAL_PATTERNS);

  if (normative || definitional) {
    const kind = normative ? 'normative/value' : 'definitional/tautological';
    const base: Record<string, unknown> = {
      question,
      falsifiable: false,
      reason: `This reads as a ${kind} claim: no conceivable observation could prove it wrong, so it sits outside the scientific method.`,
      reframedHint:
        'Reframe it as an empirical prediction \u2014 state what you would expect to observe, and what observation would prove it wrong.',
    };
    if (consensusAppeal) {
      base.consensusAppeal = true;
      base.challenge = CONSENSUS_CHALLENGE;
    }
    return okResult(base);
  }

  const moved = advance(state, 'hypothesize');
  if ('err' in moved) {
    return moved.err;
  }

  const payload: Record<string, unknown> = {
    question,
    falsifiable: true,
    reason:
      'No non-scientific red flags detected. Proceed to state a hypothesis with at least one falsification condition.',
  };
  if (consensusAppeal) {
    payload.consensusAppeal = true;
    payload.challenge = CONSENSUS_CHALLENGE;
  }
  return withState(payload, moved.next);
}

/** Hypothesize input. */
export interface HypothesizeInput {
  statement: string;
  predicts: string;
  falsificationConditions?: { description: string; observable?: boolean | undefined }[] | undefined;
  cycleState?: CycleState | undefined;
}

/**
 * Turn a candidate claim into a disciplined hypothesis. REQUIRES at least one
 * falsification condition or the claim is refused with a named honesty rule.
 * Applies the quantitative lens, then advances Hypothesis → Experiment.
 */
export function opHypothesize(input: HypothesizeInput, principles?: QuantEntry[]): OpResult {
  const state: CycleState = input.cycleState ?? 'hypothesis';

  const parsed = HypothesisSchema.safeParse({
    statement: input.statement,
    predicts: input.predicts,
    falsificationConditions: input.falsificationConditions ?? [],
  });
  if (!parsed.success) {
    return errorResult(
      'A hypothesis must state at least one observation that would prove it wrong.',
      'honesty:falsification-condition-required',
      'Add a non-empty falsificationConditions entry describing what you would observe if the hypothesis were false.',
    );
  }

  const lens = principles ?? getDefaultQuantPrinciples();
  const quantFlags = applyQuantitativeLens(`${parsed.data.statement} ${parsed.data.predicts}`, lens);

  const moved = advance(state, 'experiment');
  if ('err' in moved) {
    return moved.err;
  }

  return withState({ hypothesis: parsed.data, quantFlags }, moved.next);
}

/** Experiment input. */
export interface ExperimentInput {
  decisiveEvidence?: string[] | undefined;
  couldFail: boolean;
  cycleState?: CycleState | undefined;
}

/**
 * Design the decisive test, which MUST be able to fail. Refuses a test that
 * cannot come out the other way, or one with no decisive evidence. Advances
 * Experiment → Analysis.
 */
export function opExperiment(input: ExperimentInput): OpResult {
  const state: CycleState = input.cycleState ?? 'experiment';

  if (input.couldFail !== true) {
    return errorResult(
      'An experiment that cannot fail proves nothing.',
      'honesty:experiment-must-be-able-to-fail',
      'Set couldFail to true only if there is a real observation that would refute the hypothesis; otherwise redesign the test.',
    );
  }

  const parsed = ExperimentSchema.safeParse({
    decisiveEvidence: input.decisiveEvidence ?? [],
    couldFail: input.couldFail,
  });
  if (!parsed.success) {
    return errorResult(
      'An experiment must name at least one piece of decisive evidence.',
      'honesty:experiment-needs-decisive-evidence',
      'List the observation(s) that would decide the hypothesis in decisiveEvidence.',
    );
  }

  const moved = advance(state, 'analyze');
  if ('err' in moved) {
    return moved.err;
  }

  return withState({ experiment: parsed.data }, moved.next);
}

/** Analyze input. */
export interface AnalyzeInput {
  verdict: 'yes' | 'no';
  evidenceCited?: string[] | undefined;
  cycleState?: CycleState | undefined;
}

/**
 * Compare the data to the prediction. A 'no' takes the mandatory No branch to
 * Review. A 'yes' is NOT final — Review is mandatory even on a yes — so it stays
 * in Analysis and reports `reviewRequired` (DESIGN.md §3).
 */
export function opAnalyze(input: AnalyzeInput): OpResult {
  const state: CycleState = input.cycleState ?? 'analysis';

  const parsed = AnalysisSchema.safeParse({
    verdict: input.verdict,
    evidenceCited: input.evidenceCited ?? [],
  });
  if (!parsed.success) {
    return errorResult(
      'An analysis must cite the evidence its verdict rests on.',
      'analysis:evidence-required',
      'List the observation(s) the verdict is based on in evidenceCited.',
    );
  }

  if (parsed.data.verdict === 'no') {
    const moved = advance(state, 'refute');
    if ('err' in moved) {
      return moved.err;
    }
    return withState({ analysis: parsed.data }, moved.next);
  }

  // verdict === 'yes' — do NOT finalize; Review is mandatory (DESIGN.md §3).
  if (!legalEvents(state).includes('confirm')) {
    return errorResult(
      `A 'yes' verdict is only meaningful from the Analysis state (got '${state}').`,
      'cycle:illegal-transition',
      'Run analyze from the analysis state reached after the experiment.',
    );
  }
  return okResult({
    analysis: parsed.data,
    reviewRequired: true,
    nextTool: 'falsify_review',
    cycleState: state,
    legalNext: legalEvents(state),
    note: 'Yes is not final: run review (outcome: confirm) to record a Theory.',
  });
}

/** Review input. */
export interface ReviewInput {
  q1Methods: string;
  q2Hypothesis: string;
  q3Theory: string;
  outcome: 'revise' | 'confirm';
  cycleState?: CycleState | undefined;
}

/**
 * The mandatory review checkpoint. All three questions must be answered. Use
 * 'revise' to loop back to Hypothesis (the No branch) or 'confirm' (only after a
 * yes verdict) to finalize a Theory.
 */
export function opReview(input: ReviewInput): OpResult {
  const { outcome } = input;
  const state: CycleState = input.cycleState ?? (outcome === 'confirm' ? 'analysis' : 'review');

  const answers = [input.q1Methods, input.q2Hypothesis, input.q3Theory];
  if (answers.some((a) => a.trim().length === 0)) {
    return errorResult(
      'All three review questions must be answered, in order.',
      'review:three-questions-required',
      'Provide non-empty q1Methods, q2Hypothesis, and q3Theory before revising or confirming.',
    );
  }

  const event: CycleEvent = outcome === 'confirm' ? 'confirm' : 'revise';
  const moved = advance(state, event);
  if ('err' in moved) {
    return moved.err;
  }

  return withState(
    {
      review: {
        q1Methods: input.q1Methods,
        q2Hypothesis: input.q2Hypothesis,
        q3Theory: input.q3Theory,
      },
      outcome,
    },
    moved.next,
  );
}

/** Recall input. */
export interface RecallInput {
  query: string;
  limit?: number | undefined;
}

/**
 * Recall prior knowledge from the Corpus tier (OpenBrain, semantic search).
 * Degrades gracefully: an unconfigured or unreachable brain returns a structured
 * `recall:brain-unreachable` error, never the key (DESIGN.md §5; key never
 * leaks). The reader is injectable so tests make no real network call.
 */
export async function opRecall(input: RecallInput, reader?: MemoryReader): Promise<OpResult> {
  let active: MemoryReader;
  try {
    active = reader ?? getDefaultReader();
  } catch {
    return errorResult(
      'The memory backend is not configured.',
      'recall:brain-unreachable',
      'Set OPENBRAIN_KEY (and optionally OPENBRAIN_REST_BASE) to enable recall.',
    );
  }

  const query: RecallQuery = {
    query: input.query,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };

  try {
    const results = await active.recall(query);
    return okResult({ query: input.query, results, count: results.length });
  } catch {
    return errorResult(
      'Could not reach the memory backend.',
      'recall:brain-unreachable',
      'The brain may be offline; recall is unavailable but the reasoning tools still work.',
    );
  }
}
