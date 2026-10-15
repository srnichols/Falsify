/**
 * Dissent over consensus (DESIGN.md §6).
 *
 * Falsify never calls a model, so it cannot fan a question out itself. The host
 * agent does that — it asks several models (or several perspectives) for a
 * hypothesis — and submits the competing positions here. This tool holds each one
 * to the same honesty rules as `falsify_hypothesize`, then *extracts the
 * disagreement* rather than hiding it: where the positions diverge, and which
 * observations would actually discriminate between them.
 *
 * It never picks a winner. Agreement is reported with a warning, because several
 * models agreeing is a consensus signal, not an experiment.
 */

import { HypothesisSchema } from '../domain/schemas.js';
import { normalizeEvidence } from '../domain/evidence.js';
import type { Evidence } from '../domain/evidence.js';
import { assessFalsificationCondition } from '../rules/substance.js';
import { buildKnowledgeIndex, matchKnowledge, tokenize } from '../rules/knowledgeMatch.js';
import type { KnowledgeIndex } from '../rules/knowledgeMatch.js';
import { falsifiabilityQuality, scoreClaim } from '../rules/signals.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import type { CycleContext } from './context.js';
import type { LockedHypothesis } from './session.js';
import { errorResult, isConsensusAppeal, okResult } from './operations.js';
import type { OpResult } from './operations.js';

/** One competing position submitted for comparison. */
export interface DissentPositionInput {
  /** Unique name for the position, e.g. the model or school that holds it. */
  label: string;
  /** Who produced it (a model name, a person); recorded, never weighed. */
  source?: string | undefined;
  statement: string;
  predicts: string;
  falsificationConditions?: { description: string; observable?: boolean | undefined }[] | undefined;
  evidence?: Evidence[] | undefined;
  /**
   * What the position predicts, stated structurally. When every pair of positions
   * has one, agreement is judged from the named variable and direction instead of
   * guessed from wording, which is far more reliable.
   */
  outcome?: { variable: string; direction: 'increase' | 'decrease' | 'no-change' } | undefined;
}

export interface DissentInput {
  /** The question all positions answer; used to find a matching Contested entry. */
  question?: string | undefined;
  positions: DissentPositionInput[];
}

/** Predictions whose wording overlaps at least this much (Jaccard) count as agreeing. */
const AGREE_OVERLAP = 0.6;
/** Below this they share little wording and are treated as diverging. */
const PARTIAL_OVERLAP = 0.3;
/** Two stated outcome variables this similar (Jaccard) are the same variable. */
const SAME_VARIABLE_OVERLAP = 0.5;
/** A falsifier this similar to another position's is shared, not distinguishing. */
const SHARED_FALSIFIER_OVERLAP = 0.5;
/** All pairs at least this close: warn that agreement is not evidence. */
const SUSPICIOUS_AGREEMENT = 0.8;

const UP = /\b(?:increas|rise|rises|rose|rising|higher|more|faster|improv|rais|gain|grow|greater|larger|boost)\w*/i;
const DOWN = /\b(?:decreas|fall|falls|fell|falling|lower|less|slower|worsen|reduc|loss|shrink|smaller|drop|declin)\w*/i;

type Direction = 'up' | 'down' | 'unclear';

function directionOf(text: string): Direction {
  const up = UP.test(text);
  const down = DOWN.test(text);
  if (up && !down) return 'up';
  if (down && !up) return 'down';
  return 'unclear';
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

let cachedIndex: KnowledgeIndex | undefined;
function knowledgeIndex(ctx: CycleContext | undefined): KnowledgeIndex | undefined {
  if (ctx?.knowledge !== undefined) return ctx.knowledge;
  try {
    cachedIndex ??= buildKnowledgeIndex(loadAllKnowledge());
    return cachedIndex;
  } catch {
    return undefined;
  }
}

interface CheckedPosition {
  input: DissentPositionInput;
  issues: string[];
  conditions: { description: string; observable: boolean }[];
}

/** Hold one position to the hypothesis honesty rules; collect every issue, not just the first. */
function check(input: DissentPositionInput): CheckedPosition {
  const issues: string[] = [];
  const parsed = HypothesisSchema.safeParse({
    statement: input.statement,
    predicts: input.predicts,
    falsificationConditions: input.falsificationConditions ?? [],
  });
  if (!parsed.success) {
    issues.push('Needs a statement, a prediction, and at least one falsification condition.');
    return { input, issues, conditions: [] };
  }
  for (const condition of parsed.data.falsificationConditions) {
    const assessed = assessFalsificationCondition(condition.description);
    if (!assessed.ok) issues.push(assessed.reason);
  }
  if (parsed.data.falsificationConditions.every((c) => !c.observable)) {
    issues.push('Every falsification condition is marked unobservable.');
  }
  return { input, issues, conditions: parsed.data.falsificationConditions };
}

/**
 * Compare competing positions and surface where they disagree.
 *
 * @returns per-position checks, pairwise agreement, the observations unique to each
 *   position (the tests that would discriminate), and `winner: null` always.
 */
export function opDissent(input: DissentInput, ctx?: CycleContext): OpResult {
  const labels = new Set<string>();
  for (const position of input.positions) {
    const key = position.label.trim().toLowerCase();
    if (labels.has(key)) {
      return errorResult(
        `Two positions are both labelled '${position.label}'.`,
        'dissent:duplicate-label',
        'Give each position a unique label, such as the model or school that holds it.',
      );
    }
    labels.add(key);
  }

  const checked = input.positions.map(check);
  const valid = checked.filter((c) => c.issues.length === 0);
  if (valid.length < 2) {
    const problems = checked
      .filter((c) => c.issues.length > 0)
      .map((c) => `${c.input.label}: ${c.issues.join(' ')}`)
      .join(' | ');
    return errorResult(
      'Dissent needs at least two positions that each pass the honesty rules.',
      'dissent:two-valid-positions-required',
      problems === '' ? 'Submit two or more competing positions.' : `Fix: ${problems}`,
    );
  }

  const index = knowledgeIndex(ctx);
  const predictionTokens = valid.map((c) => tokenize(c.input.predicts));
  const directions = valid.map((c) => directionOf(c.input.predicts));

  const pairs: Record<string, unknown>[] = [];
  let closest = 1;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!.input.outcome;
      const b = valid[j]!.input.outcome;
      if (a !== undefined && b !== undefined) {
        // Stated outcomes remove the guesswork: compare the named variable and direction directly.
        const sameVariable = jaccard(tokenize(a.variable), tokenize(b.variable)) >= SAME_VARIABLE_OVERLAP;
        const relation = !sameVariable ? 'different-outcomes' : a.direction === b.direction ? 'agree' : 'opposed';
        closest = Math.min(closest, relation === 'agree' ? 1 : relation === 'opposed' ? 0 : PARTIAL_OVERLAP);
        pairs.push({
          a: valid[i]!.input.label,
          b: valid[j]!.input.label,
          relation,
          basis: 'stated',
          outcomes: { [valid[i]!.input.label]: a, [valid[j]!.input.label]: b },
        });
        continue;
      }
      const overlap = jaccard(predictionTokens[i]!, predictionTokens[j]!);
      const opposed = directions[i] !== 'unclear' && directions[j] !== 'unclear' && directions[i] !== directions[j];
      closest = Math.min(closest, opposed ? 0 : overlap);
      const relation = opposed
        ? 'opposed'
        : overlap >= AGREE_OVERLAP
          ? 'agree'
          : overlap >= PARTIAL_OVERLAP
            ? 'partial'
            : 'diverge';
      pairs.push({
        a: valid[i]!.input.label,
        b: valid[j]!.input.label,
        relation,
        basis: 'wording',
        predictionOverlap: Number(overlap.toFixed(2)),
        sharedTerms: [...predictionTokens[i]!].filter((t) => predictionTokens[j]!.has(t)),
      });
    }
  }

  const conditionTokens = valid.map((c) => c.conditions.map((cond) => tokenize(cond.description)));
  const discriminatingTests = valid.map((c, i) => ({
    position: c.input.label,
    tests: c.conditions
      .filter((_, k) =>
        conditionTokens.every(
          (others, o) =>
            o === i || others.every((t) => jaccard(conditionTokens[i]![k]!, t) < SHARED_FALSIFIER_OVERLAP),
        ),
      )
      .map((cond) => cond.description),
  }));

  const positions = checked.map((c) => {
    const resolvedEvidence = normalizeEvidence([], c.input.evidence ?? [], isConsensusAppeal);
    const locked: LockedHypothesis = {
      statement: c.input.statement,
      predicts: c.input.predicts,
      falsificationConditions: c.conditions,
      lockedAt: '',
      revision: 0,
    };
    const isValid = c.issues.length === 0;
    const claimText = `${c.input.statement} ${c.input.predicts}`;
    return {
      label: c.input.label,
      ...(c.input.source !== undefined ? { source: c.input.source } : {}),
      valid: isValid,
      issues: c.issues,
      consensusAppeal: isConsensusAppeal(`${claimText} ${resolvedEvidence.map((e) => e.observation).join(' ')}`),
      ...(isValid
        ? {
            falsifiabilityQuality: Number(falsifiabilityQuality(locked, []).toFixed(2)),
            ...(resolvedEvidence.length > 0
              ? {
                  evidenceStrength: scoreClaim({
                    hypothesis: locked,
                    experimentEvidence: [],
                    evidence: resolvedEvidence,
                    knowledgeRefs: [],
                  }).evidenceStrength,
                }
              : {}),
            knowledgeMatches: index === undefined ? [] : matchKnowledge(index, claimText, { limit: 3 }),
          }
        : {}),
    };
  });

  const questionText = input.question ?? valid.map((c) => c.input.statement).join(' ');
  const contested =
    index === undefined
      ? []
      : matchKnowledge(index, questionText, { limit: 5 }).filter((m) => m.tier === 'contested');

  const unanimous = closest >= SUSPICIOUS_AGREEMENT;
  const payload: Record<string, unknown> = {
    ...(input.question !== undefined ? { question: input.question } : {}),
    positionCount: input.positions.length,
    comparedCount: valid.length,
    positions,
    agreement: { pairs, summary: unanimous ? 'unanimous' : 'split' },
    discriminatingTests,
    contestedEntries: contested,
    winner: null,
    directive:
      'No winner is chosen. Present every position with its falsifiers; the human decides, ideally by running one of the discriminating tests.',
  };
  if (unanimous) {
    payload.agreementWarning =
      'These positions agree. Agreement among models is a consensus signal, not an experiment: it can reflect shared training data. Ask which experiment showed it, and could it have come out the other way?';
  }
  return okResult(payload);
}
