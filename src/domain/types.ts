/**
 * Falsify domain types — inferred from the zod schemas so the runtime contract
 * and the static type can never drift apart.
 */

import type { z } from 'zod';
import type {
  TierSchema,
  FalsifiableFlagSchema,
  FactEntrySchema,
  PositionSchema,
  ContestedEntrySchema,
  QuantEntrySchema,
  RefutedEntrySchema,
  KnowledgeEntrySchema,
  CycleStateSchema,
  ClaimSchema,
  FalsificationConditionSchema,
  HypothesisSchema,
  ExperimentSchema,
  VerdictSchema,
  AnalysisSchema,
} from './schemas.js';

export type Tier = z.infer<typeof TierSchema>;
export type FalsifiableFlag = z.infer<typeof FalsifiableFlagSchema>;
export type FactEntry = z.infer<typeof FactEntrySchema>;
export type Position = z.infer<typeof PositionSchema>;
export type ContestedEntry = z.infer<typeof ContestedEntrySchema>;
export type QuantEntry = z.infer<typeof QuantEntrySchema>;
export type RefutedEntry = z.infer<typeof RefutedEntrySchema>;
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

export type CycleState = z.infer<typeof CycleStateSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type FalsificationCondition = z.infer<typeof FalsificationConditionSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type Experiment = z.infer<typeof ExperimentSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
