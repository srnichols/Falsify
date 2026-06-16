/**
 * Falsify domain schemas (zod).
 *
 * These schemas are the runtime boundary that enforces Falsify's honesty rules.
 * The most important one: a {@link HypothesisSchema} with zero falsification
 * conditions FAILS to parse — the engine can never emit a hypothesis that cannot
 * be proven wrong (DESIGN.md §1, §3).
 *
 * Two naming conventions live here on purpose:
 * - **Cycle domain types** (Claim, Hypothesis, Experiment, …) are produced in
 *   code and use camelCase.
 * - **KnowledgeEntry** mirrors the on-disk `knowledge/*.yaml` source of truth and
 *   therefore keeps the YAML's snake_case keys (DESIGN.md §4).
 */

import { z } from 'zod';

// ─── Knowledge hierarchy (DESIGN.md §4) ──────────────────────────────────────

/** The four knowledge tiers. Names, not L-numbers, to avoid Plan Forge collision. */
export const TierSchema = z.enum([
  'bedrock',
  'established',
  'contested',
  'quantitative',
]);

/**
 * Falsifiability flag as it appears in the seed files: a boolean for clean
 * yes/no cases, or a qualifier string for positions whose testability depends on
 * how the claim is framed (DESIGN.md §4, Contested tier).
 */
export const FalsifiableFlagSchema = z.union([
  z.boolean(),
  z.literal('depends'),
  z.literal('conditional'),
]);

/** A fact entry — Bedrock and Established tiers share this shape. */
export const FactEntrySchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  domain: z.string().min(1),
  type: z.string().min(1),
  falsifiable: FalsifiableFlagSchema,
  falsified_if: z.string().min(1),
  status: z.string().min(1),
  confidence: z.string().min(1).optional(),
  domain_of_validity: z.string().min(1).optional(),
  confirmations: z.array(z.string().min(1)).optional(),
  sources: z.array(z.string().min(1)).min(1),
});

/** One defensible side of a Contested-tier question. */
export const PositionSchema = z.object({
  label: z.string().min(1),
  claim: z.string().min(1),
  falsifiability_status: z.string().min(1),
  falsifiable: FalsifiableFlagSchema.optional(),
  falsified_if: z.string().min(1).optional(),
  evidence_pointers: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
});

/** A Contested entry — a question with multiple positions, never a winner. */
export const ContestedEntrySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  domain: z.string().min(1),
  note: z.string().min(1).optional(),
  positions: z.array(PositionSchema).min(2),
  engine_directive: z.string().min(1),
});

/** A Quantitative entry — a cross-cutting lens, not a fact (DESIGN.md §4). */
export const QuantEntrySchema = z.object({
  id: z.string().min(1),
  principle: z.string().min(1),
  statement: z.string().min(1),
  formula: z.string().min(1).optional(),
  triggers: z.array(z.string().min(1)).min(1),
  failure_guarded: z.string().min(1),
});

/** Any single knowledge entry, across all four tiers. */
export const KnowledgeEntrySchema = z.union([
  FactEntrySchema,
  ContestedEntrySchema,
  QuantEntrySchema,
]);

// ─── Cycle domain (DESIGN.md §3) ─────────────────────────────────────────────

/** The states of the Cycle of Scientific Enterprise. */
export const CycleStateSchema = z.enum([
  'intake',
  'hypothesis',
  'experiment',
  'analysis',
  'review',
  'theory',
]);

/** A raw claim entering the cycle at Intake. */
export const ClaimSchema = z.object({
  id: z.string().min(1).optional(),
  statement: z.string().min(1),
  domain: z.string().min(1).optional(),
});

/**
 * A single condition that would prove a hypothesis wrong. The description must be
 * non-empty — a falsification condition you cannot state is no condition at all.
 */
export const FalsificationConditionSchema = z.object({
  description: z.string().min(1, 'a falsification condition must describe an observation that would prove the hypothesis wrong'),
  observable: z.boolean().default(true),
});

/**
 * A testable prediction. ENFORCES the core honesty rule: at least one
 * falsification condition is required, or the object will not parse.
 */
export const HypothesisSchema = z.object({
  statement: z.string().min(1),
  predicts: z.string().min(1),
  falsificationConditions: z
    .array(FalsificationConditionSchema)
    .min(1, 'a hypothesis must state at least one falsification condition'),
});

/**
 * An "experiment": the decisive evidence that would settle the hypothesis,
 * designed so it COULD fail. `couldFail` is a literal `true` — an experiment that
 * cannot fail is not admitted (DESIGN.md §3).
 */
export const ExperimentSchema = z.object({
  decisiveEvidence: z.array(z.string().min(1)).min(1),
  couldFail: z.literal(true),
});

/** The Yes/No outcome of comparing data to a prediction. */
export const VerdictSchema = z.enum(['yes', 'no']);

/** The Analysis step's output: a verdict plus the evidence it rests on. */
export const AnalysisSchema = z.object({
  verdict: VerdictSchema,
  evidenceCited: z.array(z.string().min(1)).min(1),
});
