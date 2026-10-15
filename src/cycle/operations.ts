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
import {
  assessEvidenceList,
  assessFalsificationCondition,
  assessReviewAnswer,
} from '../rules/substance.js';
import { buildKnowledgeIndex, lookupEntry, matchKnowledge } from '../rules/knowledgeMatch.js';
import type { KnowledgeIndex } from '../rules/knowledgeMatch.js';
import { COMPARISON_PATTERN, scoreClaim } from '../rules/signals.js';
import type { KnowledgeRelation, ResolvedKnowledgeRef } from '../rules/signals.js';
import { normalizeDoi, normalizeEvidence } from '../domain/evidence.js';
import type { Evidence } from '../domain/evidence.js';
import { titleRelatesTo } from '../rules/sourceCheck.js';
import { assessIntegrity } from '../rules/integrity.js';
import type { EvidenceSearch } from '../rules/integrity.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import type { CycleContext } from './context.js';
import type { LockedHypothesis, SessionRecord } from './session.js';
import { assessMirror, canPair, linkMirror, mirrorCapReason } from './mirror.js';
import type { MirrorAssessment } from './mirror.js';
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

/**
 * Phrases that signal a normative / value claim — outside the method. Kept narrow
 * on purpose: "must" and "good" alone are common in empirical sentences ("the
 * bridge must carry 10 t", "copper is a good conductor"), so only prescriptions
 * aimed at agents and explicit moral/aesthetic predicates match.
 */
const NORMATIVE_PATTERNS: readonly RegExp[] = [
  /^\s*should\b/i,
  /\b(?:we|you|they|people|society|government(?:s)?|everyone|nobody|one|schools?|companies|nations?|doctors|voters) (?:should|shouldn't|ought to|must|must not)\b/i,
  /\bshould (?:not )?be (?:banned|allowed|illegal|legal|required|mandatory|forbidden|prohibited|punished|rewarded|abolished)\b/i,
  /\b(?:morally|ethically) (?:right|wrong|acceptable|justified|permissible)\b/i,
  /\b(?:is|are) (?:inherently |objectively |simply )?(?:evil|beautiful|ugly|immoral|wicked|virtuous)\b/i,
  /\b(?:is|are) (?:inherently |objectively |simply )?good\b(?! (?:for|at|enough|to)\b)/i,
];

/** Phrases that signal a definitional / tautological claim — unfalsifiable. */
const DEFINITIONAL_PATTERNS: readonly RegExp[] = [/\bby definition\b/i, /\bis defined as\b/i];

function matches(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** True when the text leans on consensus or authority rather than an observation. */
export function isConsensusAppeal(text: string): boolean {
  return matches(text, CONSENSUS_APPEAL_PATTERNS);
}

export function okResult(payload: Record<string, unknown>): OpResult {
  return { kind: 'ok', payload };
}

export function errorResult(error: string, rule: string, guidance: string): OpResult {
  return { kind: 'error', error, rule, guidance };
}

/** The tool that moves the cycle on from each state. */
const NEXT_TOOL: Partial<Record<CycleState, string>> = {
  hypothesis: 'falsify_hypothesize',
  experiment: 'falsify_experiment',
  analysis: 'falsify_analyze',
  review: 'falsify_review',
};

const STATELESS_WARNING =
  'No sessionId was used, so this step ran statelessly: the server cannot verify the cycle, and a Theory cannot be verified or recorded. Pass the sessionId that falsify_intake returned.';

/**
 * An ok result that also reports where the cycle now stands. In a session it names
 * the next tool and repeats the sessionId, because a model follows an instruction
 * in the result far more reliably than one in a tool description it read earlier.
 */
function withState(payload: Record<string, unknown>, state: CycleState): OpResult {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined;
  const nextTool = NEXT_TOOL[state];
  const guidance: Record<string, unknown> =
    sessionId === undefined
      ? { sessionWarning: STATELESS_WARNING }
      : nextTool !== undefined
        ? { next: { tool: nextTool, sessionId } }
        : {};
  return okResult({ ...payload, ...guidance, cycleState: state, legalNext: legalEvents(state) });
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

/** Lazily-built, memoized index over the default knowledge tiers. */
let cachedIndex: KnowledgeIndex | undefined;
function getDefaultKnowledgeIndex(): KnowledgeIndex {
  if (cachedIndex === undefined) {
    cachedIndex = buildKnowledgeIndex(loadAllKnowledge());
  }
  return cachedIndex;
}

/** Everything a session-aware operation needs to resolve and advance its session. */
interface SessionLookup {
  session?: SessionRecord;
  state: CycleState;
}

/**
 * Resolve the cycle state for an operation. With a `sessionId` the session is
 * authoritative and a conflicting caller-supplied `cycleState` is rejected;
 * without one the operation is stateless and trusts the caller.
 */
function resolveState(
  sessionId: string | undefined,
  ctx: CycleContext | undefined,
  cycleState: CycleState | undefined,
  fallback: CycleState,
): SessionLookup | { err: OpResult } {
  if (sessionId === undefined) {
    if (ctx?.requireSession === true) {
      return {
        err: errorResult(
          'This server requires a sessionId on every step after intake.',
          'session:required',
          'Call falsify_intake first and pass the sessionId it returns to every later falsify_* call.',
        ),
      };
    }
    return { state: cycleState ?? fallback };
  }
  if (ctx?.sessions === undefined) {
    return {
      err: errorResult(
        'Sessions are not available on this server.',
        'session:unavailable',
        'Omit sessionId and pass cycleState instead.',
      ),
    };
  }
  const session = ctx.sessions.get(sessionId);
  if (session === undefined) {
    return {
      err: errorResult(
        `No session '${sessionId}'.`,
        'session:unknown',
        'Start a new inquiry with falsify_intake and use the sessionId it returns.',
      ),
    };
  }
  if (cycleState !== undefined && cycleState !== session.state) {
    return {
      err: errorResult(
        `cycleState '${cycleState}' conflicts with the session, which is at '${session.state}'.`,
        'session:state-mismatch',
        'Omit cycleState when you pass a sessionId; the session tracks the state itself.',
      ),
    };
  }
  return { session, state: session.state };
}

/** Record a successful transition on the session and persist it. */
function commit(
  ctx: CycleContext | undefined,
  session: SessionRecord | undefined,
  event: string,
  next: CycleState,
  summary: string,
): void {
  if (session === undefined || ctx?.sessions === undefined) {
    return;
  }
  session.history.push({ at: new Date().toISOString(), event, from: session.state, to: next, summary });
  session.state = next;
  ctx.sessions.save(session);
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
  /** The sessionId of the inquiry this one is the opposite framing of; both are linked. */
  mirrorOf?: string | undefined;
}

/**
 * Decide whether a question is falsifiable (Popper's line). Flags normative,
 * definitional, or consensus-appeal phrasings; a consensus appeal is answered
 * with the essay's challenge, never deference. A falsifiable claim advances
 * Intake → Hypothesis.
 */
export function opIntake(input: IntakeInput, ctx?: CycleContext): OpResult {
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
  if (ctx?.sessions !== undefined) {
    if (input.mirrorOf !== undefined) {
      const pairable = canPair(ctx, input.mirrorOf);
      if (!pairable.ok) return errorResult(pairable.error, pairable.rule, pairable.guidance);
    }
    const created = ctx.sessions.create(question);
    payload.sessionId = created.id;
    if (input.mirrorOf !== undefined) {
      linkMirror(ctx, created, input.mirrorOf);
      payload.mirrorOf = input.mirrorOf;
    }
  } else if (input.mirrorOf !== undefined) {
    return errorResult(
      'Mirroring needs a session store.',
      'mirror:session-required',
      'Run the server with its default on-disk context so inquiries can be linked.',
    );
  }
  return withState(payload, moved.next);
}

/** The kinds of claim whose falsification works differently. */
export type ClaimType = 'universal' | 'existential' | 'probabilistic' | 'causal';

/** Hypothesize input. */
export interface HypothesizeInput {
  statement: string;
  predicts: string;
  falsificationConditions?: { description: string; observable?: boolean | undefined }[] | undefined;
  /** Shape of the claim; changes what a valid falsifier must look like. */
  claimType?: ClaimType | undefined;
  /** Background assumptions the test relies on (Duhem–Quine); checked again at Review. */
  assumptions?: string[] | undefined;
  /** After a refutation: what changed and why, other than fitting the data. */
  revisionNote?: string | undefined;
  sessionId?: string | undefined;
  cycleState?: CycleState | undefined;
}

const CLAIM_TYPE_GUIDANCE: Record<ClaimType, string> = {
  universal: 'A single well-controlled counterexample refutes a universal claim; make the falsifier that counterexample.',
  existential:
    'An existence claim is refuted only by an exhaustive search of a stated scope; failing to find it once is not a refutation. State the scope.',
  probabilistic: 'A statistical claim is refuted by a pre-stated threshold; the falsifier must name it.',
  causal: 'A causal claim needs a comparison (control, placebo, or intervention); the experiment must include one.',
};

/** Minimum words for a revision note to count as an explanation. */
const MIN_REVISION_NOTE_WORDS = 5;

/**
 * Turn a candidate claim into a disciplined hypothesis. REQUIRES at least one
 * falsification condition that names an observation, or the claim is refused with
 * a named honesty rule. Surfaces the knowledge tiers the claim touches, applies
 * the quantitative lens, locks the prediction into the session (pre-registration),
 * and advances Hypothesis → Experiment.
 *
 * After a refutation, a revised hypothesis must say what changed and may not
 * become less falsifiable than the one it replaces — no rescuing a claim by
 * making it harder to refute.
 */
export function opHypothesize(
  input: HypothesizeInput,
  principles?: QuantEntry[],
  ctx?: CycleContext,
): OpResult {
  const resolved = resolveState(input.sessionId, ctx, input.cycleState, 'hypothesis');
  if ('err' in resolved) {
    return resolved.err;
  }
  const { session, state } = resolved;

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
  const hypothesis = parsed.data;

  for (const condition of hypothesis.falsificationConditions) {
    const assessed = assessFalsificationCondition(condition.description);
    if (!assessed.ok) {
      return errorResult(
        assessed.reason,
        'honesty:falsification-condition-vacuous',
        'Describe what would be measured and what result would refute the claim, e.g. "no drop in reaction time versus placebo after two weeks".',
      );
    }
  }
  if (hypothesis.falsificationConditions.every((c) => !c.observable)) {
    return errorResult(
      'Every falsification condition is marked unobservable.',
      'honesty:falsification-condition-unobservable',
      'At least one condition must be an observation someone could actually make.',
    );
  }
  if (
    input.claimType === 'probabilistic' &&
    !hypothesis.falsificationConditions.some((c) => /\d/.test(c.description))
  ) {
    return errorResult(
      'A probabilistic claim needs a numeric falsification threshold.',
      'honesty:statistical-threshold-required',
      'State the threshold (effect size, alpha, or sample size) in at least one falsification condition.',
    );
  }

  if (session?.pendingRevision === true) {
    const note = (input.revisionNote ?? '').trim();
    if (note.split(/\s+/).filter(Boolean).length < MIN_REVISION_NOTE_WORDS) {
      return errorResult(
        'A revised hypothesis must explain what changed and why.',
        'honesty:revision-note-required',
        'Pass revisionNote: say what the refutation taught you and what you changed in response, other than fitting the data.',
      );
    }
    const previous = session.refuted[session.refuted.length - 1];
    if (previous !== undefined && hypothesis.falsificationConditions.length < previous.falsificationConditions.length) {
      return errorResult(
        `The revision drops falsification conditions (${hypothesis.falsificationConditions.length} < ${previous.falsificationConditions.length}); it is easier to survive than the claim it replaces.`,
        'honesty:revision-weakens-falsifiability',
        'Keep every earlier falsification condition (or replace each with an equally strict one) and add new ones as needed.',
      );
    }
  }

  const lens = principles ?? getDefaultQuantPrinciples();
  const claimText = `${hypothesis.statement} ${hypothesis.predicts}`;
  const quantFlags = applyQuantitativeLens(claimText, lens);

  let knowledgeMatches: ReturnType<typeof matchKnowledge> = [];
  try {
    knowledgeMatches = matchKnowledge(ctx?.knowledge ?? getDefaultKnowledgeIndex(), claimText);
  } catch {
    // The knowledge tiers are advisory here; a missing corpus must not block the cycle.
  }

  const moved = advance(state, 'experiment');
  if ('err' in moved) {
    return moved.err;
  }

  const payload: Record<string, unknown> = { hypothesis, quantFlags, knowledgeMatches };
  if (input.claimType !== undefined) {
    payload.claimGuidance = CLAIM_TYPE_GUIDANCE[input.claimType];
  }
  if (input.assumptions !== undefined && input.assumptions.length > 0) {
    payload.assumptionsToRevisit = input.assumptions;
  }

  if (session !== undefined) {
    const revision = session.refuted.length;
    const locked: LockedHypothesis = {
      statement: hypothesis.statement,
      predicts: hypothesis.predicts,
      falsificationConditions: hypothesis.falsificationConditions,
      lockedAt: new Date().toISOString(),
      revision,
      ...(input.claimType !== undefined ? { claimType: input.claimType } : {}),
      ...(input.assumptions !== undefined ? { assumptions: input.assumptions } : {}),
      ...(session.pendingRevision && input.revisionNote !== undefined ? { revisionNote: input.revisionNote.trim() } : {}),
    };
    session.hypothesis = locked;
    session.pendingRevision = false;
    delete session.analysis;
    delete session.experiment;
    payload.sessionId = session.id;
    payload.lockedAt = locked.lockedAt;
    payload.revision = revision;
    commit(ctx, session, 'experiment', moved.next, `Hypothesis locked (revision ${revision}).`);
  }

  return withState(payload, moved.next);
}

/** Experiment input. */
export interface ExperimentInput {
  decisiveEvidence?: string[] | undefined;
  couldFail: boolean;
  sessionId?: string | undefined;
  cycleState?: CycleState | undefined;
}

/**
 * Design the decisive test, which MUST be able to fail. Refuses a test that
 * cannot come out the other way, or one with no (or only placeholder) decisive
 * evidence. For a causal hypothesis the test must include a comparison.
 * Advances Experiment → Analysis.
 */
export function opExperiment(input: ExperimentInput, ctx?: CycleContext): OpResult {
  const resolved = resolveState(input.sessionId, ctx, input.cycleState, 'experiment');
  if ('err' in resolved) {
    return resolved.err;
  }
  const { session, state } = resolved;

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

  const evidenceCheck = assessEvidenceList(parsed.data.decisiveEvidence);
  if (!evidenceCheck.ok) {
    return errorResult(
      evidenceCheck.reason,
      'honesty:experiment-evidence-vague',
      'Name the measurement or observation that would decide the hypothesis, e.g. "blinded reaction-time test before and after dosing".',
    );
  }

  if (session?.hypothesis?.claimType === 'causal') {
    const hasComparison = parsed.data.decisiveEvidence.some((e) => COMPARISON_PATTERN.test(e));
    if (!hasComparison) {
      return errorResult(
        'A causal hypothesis needs a comparison in its test.',
        'honesty:causal-claim-needs-comparison',
        'Include a control, placebo, randomized comparison, or before/after intervention in the decisive evidence.',
      );
    }
  }

  const moved = advance(state, 'analyze');
  if ('err' in moved) {
    return moved.err;
  }

  if (session !== undefined) {
    session.experiment = { decisiveEvidence: parsed.data.decisiveEvidence };
    commit(ctx, session, 'analyze', moved.next, 'Decisive test designed.');
    return withState({ experiment: parsed.data, sessionId: session.id }, moved.next);
  }
  return withState({ experiment: parsed.data }, moved.next);
}

/** A link the analyst asserts between the claim and a Bedrock/Established entry. */
export interface KnowledgeRefInput {
  id: string;
  relation: KnowledgeRelation;
}

/** Analyze input. */
export interface AnalyzeInput {
  verdict: 'yes' | 'no';
  /** Free-text observations; each is normalized into an evidence item. */
  evidenceCited?: string[] | undefined;
  /** Structured evidence with provenance and statistics; used by the claim score. */
  evidence?: Evidence[] | undefined;
  /** Bedrock/Established entries the claim supports or conflicts with. */
  knowledgeRefs?: KnowledgeRefInput[] | undefined;
  sessionId?: string | undefined;
  cycleState?: CycleState | undefined;
  /** What was searched and what contradicts the claim. Required for a "yes" in a session. */
  evidenceSearch?: EvidenceSearch | undefined;
  /** The hypothesis itself asserts no effect, so a non-significant result supports it. */
  nullHypothesisClaim?: boolean | undefined;
}

/** Look up the analyst's knowledge references; only Bedrock and Established carry support weight. */
function resolveKnowledgeRefs(
  refs: readonly KnowledgeRefInput[],
  ctx: CycleContext | undefined,
): ResolvedKnowledgeRef[] | OpResult {
  if (refs.length === 0) {
    return [];
  }
  let index: KnowledgeIndex;
  try {
    index = ctx?.knowledge ?? getDefaultKnowledgeIndex();
  } catch {
    return errorResult(
      'The knowledge corpus could not be loaded, so knowledgeRefs cannot be checked.',
      'analysis:knowledge-unavailable',
      'Omit knowledgeRefs, or fix the knowledge/ directory.',
    );
  }
  const resolved: ResolvedKnowledgeRef[] = [];
  for (const ref of refs) {
    const found = lookupEntry(index, ref.id);
    if (found === undefined) {
      return errorResult(
        `No knowledge entry '${ref.id}'.`,
        'analysis:unknown-knowledge-ref',
        'Use an id returned in knowledgeMatches from falsify_hypothesize.',
      );
    }
    if (found.tier !== 'bedrock' && found.tier !== 'established') {
      return errorResult(
        `'${ref.id}' is a ${found.tier} entry; only Bedrock and Established entries can be supported or contradicted.`,
        'analysis:knowledge-ref-tier',
        'Contested positions are presented, not scored; refuted lookalikes are addressed in review.',
      );
    }
    resolved.push({ id: ref.id, tier: found.tier, relation: ref.relation });
  }
  return resolved;
}

/**
 * Compare the data to the prediction. A 'no' takes the mandatory No branch to
 * Review. A 'yes' is NOT final — Review is mandatory even on a yes — so it stays
 * in Analysis and reports `reviewRequired` (DESIGN.md §3).
 *
 * Consensus is a signal, not evidence: an analysis whose every cited item is an
 * appeal to authority is refused, and a mixed one is answered with the challenge.
 * Within a session the evidence is scored (`claimScore`); a yes that conflicts
 * with Bedrock/Established knowledge must rest on a sourced experiment or
 * statistical result, not on observation alone.
 */
export function opAnalyze(input: AnalyzeInput, ctx?: CycleContext): OpResult {
  const resolved = resolveState(input.sessionId, ctx, input.cycleState, 'analysis');
  if ('err' in resolved) {
    return resolved.err;
  }
  const { session, state } = resolved;

  const verifiedDois = new Set(Object.keys(session?.verifiedSources ?? {}));
  const unverifiedReplications: string[] = [];
  const items = normalizeEvidence(input.evidenceCited ?? [], input.evidence ?? [], isConsensusAppeal, verifiedDois)
    .map((item) => {
      if (item.replicated !== true || item.kind === 'consensus') return item;
      const own = item.doi !== undefined ? normalizeDoi(item.doi) : undefined;
      const replication = item.replicationDoi !== undefined ? normalizeDoi(item.replicationDoi) : undefined;
      const title = replication !== undefined ? session?.verifiedSources?.[replication]?.title : undefined;
      const credited =
        replication !== undefined &&
        replication !== own &&
        title !== undefined &&
        titleRelatesTo(title, [item.observation, session?.hypothesis?.statement ?? '', session?.hypothesis?.predicts ?? '']);
      if (credited) return item;
      unverifiedReplications.push(item.observation);
      return { ...item, replicated: false };
    })
    .map((item) => {
    const doi = item.doi !== undefined ? normalizeDoi(item.doi) : undefined;
    const title = doi !== undefined ? session?.verifiedSources?.[doi]?.title : undefined;
    if (item.sourceVerified !== true || title === undefined) return item;
    const related = titleRelatesTo(title, [
      item.observation,
      session?.hypothesis?.statement ?? '',
      session?.hypothesis?.predicts ?? '',
    ]);
    if (related) return item;
    // A real paper on an unrelated topic is not support: withhold the verified credit.
    return { ...item, sourceVerified: false, sourceTopicMismatch: true };
  });
  const parsed = AnalysisSchema.safeParse({
    verdict: input.verdict,
    evidenceCited: items.map((i) => i.observation),
  });
  if (!parsed.success) {
    return errorResult(
      'An analysis must cite the evidence its verdict rests on.',
      'analysis:evidence-required',
      'List the observation(s) the verdict is based on in evidenceCited, or pass structured evidence.',
    );
  }

  const evidenceCheck = assessEvidenceList(parsed.data.evidenceCited);
  if (!evidenceCheck.ok) {
    return errorResult(
      evidenceCheck.reason,
      'analysis:evidence-vague',
      'Cite the observation or measurement itself, not a label for it.',
    );
  }

  const appeals = items.filter((i) => i.kind === 'consensus').map((i) => i.observation);
  if (appeals.length === items.length) {
    return errorResult(
      'Consensus is a signal, not evidence: every cited item is an appeal to authority.',
      'analysis:consensus-is-not-evidence',
      `${CONSENSUS_CHALLENGE} Cite that experiment's observation instead.`,
    );
  }

  const refs = resolveKnowledgeRefs(input.knowledgeRefs ?? [], ctx);
  if (!Array.isArray(refs)) {
    return refs;
  }
  if (parsed.data.verdict === 'yes' && !legalEvents(state).includes('confirm')) {
    return errorResult(
      `A 'yes' verdict is only meaningful from the Analysis state (got '${state}').`,
      'cycle:illegal-transition',
      'Run analyze from the analysis state reached after the experiment.',
    );
  }
  const conflicts = refs.some((r) => r.relation === 'conflicts');
  if (
    parsed.data.verdict === 'yes' &&
    conflicts &&
    !items.some((i) => (i.kind === 'experiment' || i.kind === 'statistical') && i.source !== undefined)
  ) {
    return errorResult(
      'This claim conflicts with Bedrock/Established knowledge, so a yes needs decisive evidence.',
      'analysis:decisive-evidence-required',
      'Cite at least one evidence item of kind "experiment" or "statistical" with a source; observation alone cannot override a law.',
    );
  }

  const integrity = assessIntegrity({
    verdict: parsed.data.verdict,
    items,
    evidenceSearch: input.evidenceSearch,
    nullHypothesisClaim: input.nullHypothesisClaim,
    refutedAttempts: session?.refuted.length ?? 0,
    strict: session !== undefined,
  });
  if (integrity.refusal !== undefined) {
    return errorResult(integrity.refusal.error, integrity.refusal.rule, integrity.refusal.guidance);
  }

  const consensusNote: Record<string, unknown> = {
    ...(unverifiedReplications.length > 0
      ? {
          replicationNotCredited: unverifiedReplications,
          replicationNote:
            'These items were marked replicated but earned no replication credit: a replication needs its own replicationDoi (different from the original source), confirmed with falsify_verify_source in this session, whose title relates to the claim. They are scored as unreplicated.',
        }
      : {}),
    ...(appeals.length > 0 ? { consensusCitedAsEvidence: appeals, challenge: CONSENSUS_CHALLENGE } : {}),
    ...integrity.flags,
    ...(integrity.multiplicity !== undefined ? { multiplicity: integrity.multiplicity } : {}),
    ...(integrity.contraryCap
      ? { contraryEvidenceNote: 'Contrary results were disclosed, so this claim cannot be rated "strong" however good the supporting evidence.' }
      : {}),
  };
  const lockedAt = session?.hypothesis?.lockedAt;
  const provenance: Record<string, unknown> =
    lockedAt !== undefined ? { predictionLockedAt: lockedAt } : {};
  const report =
    session?.hypothesis !== undefined
      ? scoreClaim(
          {
            hypothesis: session.hypothesis,
            experimentEvidence: session.experiment?.decisiveEvidence ?? [],
            evidence: items,
            knowledgeRefs: refs,
            attempts: (session.refuted.length ?? 0) + 1,
            contraryFound: input.evidenceSearch?.contraryFound ?? 0,
          },
          ctx?.weights,
        )
      : undefined;
  const scoring: Record<string, unknown> = report !== undefined ? { claimScore: report } : {};
  const doiItems = items.filter((i) => i.doi !== undefined);
  if (doiItems.length > 0) {
    const unverified = doiItems.filter((i) => i.sourceVerified !== true && i.sourceTopicMismatch !== true).map((i) => i.doi);
    const mismatched = doiItems.filter((i) => i.sourceTopicMismatch === true).map((i) => i.doi);
    const unsupported = doiItems
      .filter((i) => {
        const doi = i.doi !== undefined ? normalizeDoi(i.doi) : undefined;
        return doi !== undefined && session?.verifiedSources?.[doi]?.support === 'no';
      })
      .map((i) => i.doi);
    scoring.sourceCheck = {
      verified: doiItems.filter((i) => i.sourceVerified === true).length,
      unverified,
      ...(unsupported.length > 0
        ? {
            judgeSaysUnsupported: unsupported,
            judgeNote:
              "Advisory: when you verified these DOIs, a language model read the abstract and did not find the observation you cite them for. It can be wrong and it did not change the score; check the paper.",
          }
        : {}),
      ...(mismatched.length > 0
        ? {
            possiblyUnrelated: mismatched,
            mismatchNote:
              'These DOIs exist, but their titles share nothing with your claim or observation, so they earn no verified credit. Cite the work that actually reports this observation.',
          }
        : {}),
      ...(unverified.length > 0
        ? { note: 'Call falsify_verify_source for each unverified DOI (with this sessionId) to earn full source credit.' }
        : {}),
    };
  }
  const recordAnalysis = (): void => {
    if (session === undefined) return;
    session.analysis = {
      ...parsed.data,
      at: new Date().toISOString(),
      evidence: items,
      ...(input.evidenceSearch !== undefined ? { evidenceSearch: input.evidenceSearch } : {}),
      ...(integrity.multiplicity !== undefined ? { attempts: integrity.multiplicity.attempts } : {}),
      ...(report !== undefined
        ? { score: { score: report.score, nonConsensusScore: report.nonConsensusScore, evidenceStrength: report.evidenceStrength } }
        : {}),
    };
  };

  if (parsed.data.verdict === 'no') {
    const moved = advance(state, 'refute');
    if ('err' in moved) {
      return moved.err;
    }
    if (session !== undefined) {
      recordAnalysis();
      commit(ctx, session, 'refute', moved.next, 'Data disagreed with the prediction (No branch).');
    }
    return withState(
      { analysis: parsed.data, evidence: items, ...(session !== undefined ? { sessionId: session.id } : {}), ...scoring, ...consensusNote, ...provenance },
      moved.next,
    );
  }

  // verdict === 'yes' — do NOT finalize; Review is mandatory (DESIGN.md §3).
  if (session !== undefined) {
    recordAnalysis();
    commit(ctx, session, 'analyze-yes', state, 'Data agreed with the prediction; review required.');
  }
  return okResult({
    analysis: parsed.data,
    evidence: items,
    reviewRequired: true,
    nextTool: 'falsify_review',
    next: session !== undefined ? { tool: 'falsify_review', sessionId: session.id } : undefined,
    ...(session !== undefined ? { sessionId: session.id } : { sessionWarning: STATELESS_WARNING }),
    cycleState: state,
    legalNext: legalEvents(state),
    note: 'Yes is not final: run review (outcome: confirm) to record a Theory.',
    ...scoring,
    ...consensusNote,
    ...provenance,
  });
}

/** Review input. */
export interface ReviewInput {
  q1Methods: string;
  q2Hypothesis: string;
  q3Theory: string;
  outcome: 'revise' | 'confirm';
  sessionId?: string | undefined;
  cycleState?: CycleState | undefined;
  /** Confirm a theory whose evidence is only "weak", recorded as tentative rather than refused. */
  acceptTentative?: boolean | undefined;
}

/** How much weight a recorded theory deserves, from its evidence strength. */
type EpistemicStatus = 'supported' | 'provisional' | 'tentative';

const EPISTEMIC_BY_STRENGTH: Record<'strong' | 'moderate' | 'weak', EpistemicStatus> = {
  strong: 'supported',
  moderate: 'provisional',
  weak: 'tentative',
};

const PROCESS_NOT_PROOF =
  'Completing the cycle records that the process was followed. It does not establish that the claim is true, and every input was supplied by the caller.';
/**
 * True when the evidence cites DOIs but every one of them resolves to a paper whose title
 * shares nothing with the claim, and no cited source was verified as relevant: the
 * "source" then supports nothing. Items with no DOI do not rescue it; they are assertions.
 */
function hasOnlyOffTopicSources(evidence: readonly { doi?: string | undefined; sourceVerified?: boolean | undefined; sourceTopicMismatch?: boolean | undefined; kind?: string | undefined }[]): boolean {
  const cited = evidence.filter((e) => e.kind !== 'consensus' && e.doi !== undefined);
  return cited.length > 0 && cited.every((e) => e.sourceTopicMismatch === true) && !evidence.some((e) => e.sourceVerified === true);
}

/** Mirror assessment as a result payload: the comparison, not a verdict. */
function mirrorPayload(m: MirrorAssessment): Record<string, unknown> {
  if (!m.linked) {
    return { linked: false, note: 'No opposite framing is linked. Start one with falsify_intake and mirrorOf to test the other side the same way.' };
  }
  return {
    linked: true,
    completed: m.completed,
    ...(m.partner !== undefined ? { oppositeFraming: m.partner } : {}),
    ...(m.bothYes ? { bothFramingsYes: true } : {}),
    ...(m.asymmetries.length > 0 ? { asymmetries: m.asymmetries } : {}),
  };
}

/** Plain-text rendering of a locked hypothesis for the notebook and corpus. */
function renderHypothesis(h: LockedHypothesis): string {
  const falsifiers = h.falsificationConditions.map((c) => c.description.trim().replace(/[.\s]+$/, '')).join('; ');
  return `${h.statement.trim().replace(/[.\s]+$/, '')} — predicts: ${h.predicts.trim().replace(/[.\s]+$/, '')}. Falsified if: ${falsifiers}.`;
}

/** Record a refuted hypothesis in the notebook: kept legible, struck through, dated. */
function recordRefutation(ctx: CycleContext | undefined, session: SessionRecord, input: ReviewInput): string | undefined {
  if (ctx?.notebook === undefined || session.hypothesis === undefined) {
    return undefined;
  }
  const item = ctx.notebook.record({ kind: 'hypothesis', text: renderHypothesis(session.hypothesis) });
  const evidence = session.analysis?.evidenceCited.join('; ') ?? 'data disagreed with the prediction';
  ctx.notebook.strikeThrough(
    item.id,
    `Refuted by: ${evidence}. Methods: ${input.q1Methods.trim()} Hypothesis: ${input.q2Hypothesis.trim()} Theory: ${input.q3Theory.trim()}`,
  );
  return item.id;
}

/** Record a theory that survived its test: notebook first, corpus best-effort. */
function recordTheory(
  ctx: CycleContext | undefined,
  session: SessionRecord,
  status: EpistemicStatus,
  mirrorTested: boolean,
): Record<string, unknown> {
  const hypothesis = session.hypothesis;
  if (hypothesis === undefined) {
    return {};
  }
  const text = renderHypothesis(hypothesis);
  const recorded: Record<string, unknown> = {};
  if (ctx?.notebook !== undefined) {
    recorded.notebookId = ctx.notebook.record({ kind: 'theory', text: `${text} [${status}; a process record, not proof]` }).id;
  }
  if (ctx?.corpus !== undefined) {
    // Best-effort fan-out: a corpus failure must never block or fail the cycle.
    // The client queues unsent writes locally, so an offline brain loses nothing.
    ctx.corpus
      .save({
        content: `Survived test (${status}): ${text}`,
        source: 'falsify-cycle',
        metadata: {
          tier: 'survived-test',
          epistemic_status: status,
          mirror_tested: mirrorTested,
          falsifiable: true,
          falsified_if: hypothesis.falsificationConditions.map((c) => c.description).join('; '),
          revisions_survived: hypothesis.revision,
          hypotheses_tried: session.refuted.length + 1,
          ...(session.analysis?.evidenceSearch !== undefined
            ? { contrary_evidence_found: session.analysis.evidenceSearch.contraryFound }
            : {}),
          ...(session.analysis?.score !== undefined
            ? {
                evidence_strength: session.analysis.score.evidenceStrength,
                claim_score: session.analysis.score.score,
              }
            : {}),
          session: session.id,
        },
      })
      .catch(() => undefined);
    recorded.corpus = 'save-attempted';
  }
  return recorded;
}

/**
 * The mandatory review checkpoint. All three questions must be answered with a
 * real answer. Use 'revise' to loop back to Hypothesis (the No branch) or
 * 'confirm' to finalize a Theory.
 *
 * Within a session, 'confirm' is refused unless a 'yes' verdict was actually
 * recorded, and the outcome is written to the notebook (a refuted hypothesis is
 * struck through; a surviving theory is kept). Without a session the confirm is
 * accepted on the caller's word and flagged `cycleVerified: false`; it is not recorded.
 * A confirm whose evidence is rated "weak" is refused unless `acceptTentative` says
 * to record it as tentative. A recorded theory carries an `epistemicStatus` and the
 * reminder that finishing the cycle is a process record, not proof.
 */
export function opReview(input: ReviewInput, ctx?: CycleContext): OpResult {
  const { outcome } = input;
  const resolved = resolveState(
    input.sessionId,
    ctx,
    input.cycleState,
    outcome === 'confirm' ? 'analysis' : 'review',
  );
  if ('err' in resolved) {
    return resolved.err;
  }
  const { session, state } = resolved;

  const questions: [string, string][] = [
    ['q1Methods', input.q1Methods],
    ['q2Hypothesis', input.q2Hypothesis],
    ['q3Theory', input.q3Theory],
  ];
  if (questions.some(([, a]) => a.trim().length === 0)) {
    return errorResult(
      'All three review questions must be answered, in order.',
      'review:three-questions-required',
      'Provide non-empty q1Methods, q2Hypothesis, and q3Theory before revising or confirming.',
    );
  }
  for (const [label, answer] of questions) {
    const assessed = assessReviewAnswer(label, answer);
    if (!assessed.ok) {
      return errorResult(
        assessed.reason,
        'review:substantive-answers-required',
        'Answer q1 (were the methods sound?), q2 (was the hypothesis well formed?) and q3 (is the theory wrong?) with what you actually checked.',
      );
    }
  }

  if (outcome === 'confirm' && session !== undefined && session.analysis?.verdict !== 'yes') {
    return errorResult(
      'No yes verdict is recorded for this inquiry, so there is nothing to confirm.',
      'review:yes-verdict-required',
      'Run falsify_analyze with verdict "yes" and its evidence first, then confirm.',
    );
  }
  const strength = session?.analysis?.score?.evidenceStrength ?? 'weak';
  if (outcome === 'confirm' && session !== undefined && strength === 'weak' && input.acceptTentative !== true) {
    return errorResult(
      'The evidence behind this "yes" is rated weak, which is not enough to confirm a theory.',
      'review:evidence-too-weak',
      'Gather stronger evidence (a sourced experiment, a replication) and run falsify_analyze again, or pass acceptTentative: true to record it explicitly as tentative.',
    );
  }

  const event: CycleEvent = outcome === 'confirm' ? 'confirm' : 'revise';
  const moved = advance(state, event);
  if ('err' in moved) {
    return moved.err;
  }

  const payload: Record<string, unknown> = {
    review: {
      q1Methods: input.q1Methods,
      q2Hypothesis: input.q2Hypothesis,
      q3Theory: input.q3Theory,
    },
    outcome,
  };

  if (session === undefined) {
    if (outcome === 'confirm') {
      payload.cycleVerified = false;
      payload.note =
        'Confirmed without a session: no yes verdict could be checked and nothing was recorded. Use the sessionId from falsify_intake for a recorded Theory. ' +
        PROCESS_NOT_PROOF;
    }
    return withState(payload, moved.next);
  }

  const mirror = assessMirror(ctx, session);
  if (outcome === 'revise') {
    const notebookId = recordRefutation(ctx, session, input);
    if (notebookId !== undefined) {
      payload.recorded = { notebookId, struck: true };
    }
    if (session.hypothesis !== undefined) {
      session.refuted.push(session.hypothesis);
    }
    session.pendingRevision = true;
    payload.nextStep = 'Revise the hypothesis: pass revisionNote and keep it at least as falsifiable.';
    if (mirror.linked) payload.mirror = mirrorPayload(mirror);
  } else {
    let status = EPISTEMIC_BY_STRENGTH[strength];
    const capReason = mirrorCapReason(mirror);
    if (capReason !== undefined && status === 'supported') {
      status = 'provisional';
      payload.statusCap = `Held at provisional rather than supported. ${capReason}`;
    }
    const sourceless = hasOnlyOffTopicSources(session.analysis?.evidence ?? []);
    if (sourceless && status !== 'tentative') {
      status = 'tentative';
      payload.statusCap = `${typeof payload.statusCap === 'string' ? `${payload.statusCap} ` : ''}Held at tentative: every DOI this "yes" cites points to a paper whose title has nothing to do with the claim, and no verified, relevant source supports it. Cite the work that reports the observation.`;
    }
    payload.cycleVerified = true;
    payload.epistemicStatus = status;
    payload.note = PROCESS_NOT_PROOF;
    payload.mirror = mirrorPayload(mirror);
    if (capReason !== undefined) payload.mirrorNote = capReason;
    payload.recorded = recordTheory(ctx, session, status, mirror.linked && mirror.completed && !mirror.bothYes);
  }
  commit(ctx, session, event, moved.next, outcome === 'confirm' ? 'Theory confirmed after review.' : 'Refuted; revising.');
  payload.sessionId = session.id;
  return withState(payload, moved.next);
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
