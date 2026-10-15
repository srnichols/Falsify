/**
 * Optional collaborators for the cycle operations.
 *
 * Every field is optional so the operations stay usable (and unit-testable) with
 * no I/O at all: with no `sessions` the cycle runs statelessly, trusting the
 * caller's `cycleState`; with no `notebook` / `corpus` nothing is recorded.
 */

import type { SessionStore } from './session.js';
import type { NotebookStore } from '../memory/notebook.js';
import type { MemoryReader, MemoryWriter } from '../memory/openbrainClient.js';
import type { KnowledgeIndex } from '../rules/knowledgeMatch.js';
import type { ScoreWeights } from '../rules/claimScore.js';

export interface CycleContext {
  /** Server-side session store; makes cycle state authoritative. */
  sessions?: SessionStore;
  /** Where refuted hypotheses (struck through) and surviving theories are kept. */
  notebook?: NotebookStore;
  /** Corpus tier writer for theories that survived their test. */
  corpus?: MemoryWriter;
  /** Corpus tier reader: semantic recall, used by `falsify_related`. */
  memory?: MemoryReader;
  /** Refuse any step after intake that does not carry a sessionId (`FALSIFY_REQUIRE_SESSION=1`). */
  requireSession?: boolean;
  /** Claim-score weights; defaults to {@link DEFAULT_WEIGHTS}. Ordering is validated on load. */
  weights?: ScoreWeights;
  /** Searchable view of the knowledge tiers. Defaulted from `knowledge/*.yaml`. */
  knowledge?: KnowledgeIndex;
}
