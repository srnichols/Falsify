/**
 * The Cycle of Scientific Enterprise as a deterministic state machine
 * (DESIGN.md §3).
 *
 * The cycle is a loop, not a line. Its defining feature is the mandatory "No"
 * branch: when Analysis disagrees with the prediction, the machine routes to
 * Review (which asks the three questions in order) and loops back to Hypothesis
 * — it never massages the data into a Yes.
 *
 *   intake → hypothesis → experiment → analysis → ┬─ confirm → theory (terminal)
 *                                ↑                └─ refute  → review → revise ─┐
 *                                └──────────────────────────────────────────────┘
 */

import type { CycleState } from '../domain/types.js';

/** The events that drive transitions between cycle states. */
export type CycleEvent =
  | 'hypothesize' // intake     → hypothesis  (the claim is falsifiable)
  | 'experiment' //  hypothesis → experiment  (design a test that could fail)
  | 'analyze' //     experiment → analysis    (compare data to prediction)
  | 'confirm' //     analysis   → theory       (verdict: yes — it survived)
  | 'refute' //      analysis   → review       (verdict: no — take the No branch)
  | 'revise'; //     review     → hypothesis   (loop back with what we learned)

/** Thrown when a transition is not permitted by the cycle. */
export class CycleTransitionError extends Error {
  constructor(
    public readonly from: CycleState,
    public readonly event: CycleEvent,
  ) {
    super(`Illegal cycle transition: '${event}' is not allowed from state '${from}'.`);
    this.name = 'CycleTransitionError';
  }
}

/** The complete, legal transition table for the cycle. */
const TRANSITIONS: Readonly<Record<CycleState, Partial<Record<CycleEvent, CycleState>>>> = {
  intake: { hypothesize: 'hypothesis' },
  hypothesis: { experiment: 'experiment' },
  experiment: { analyze: 'analysis' },
  analysis: { confirm: 'theory', refute: 'review' },
  review: { revise: 'hypothesis' },
  theory: {}, // terminal — a surviving theory is recorded, not advanced
};

/** The state every inquiry starts in. */
export const INITIAL_STATE: CycleState = 'intake';

/** A theory that survived its test is the only terminal state. */
export function isTerminal(state: CycleState): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** The events that are legal from a given state. */
export function legalEvents(state: CycleState): CycleEvent[] {
  return Object.keys(TRANSITIONS[state]) as CycleEvent[];
}

/**
 * Apply an event to the current state.
 *
 * @returns the next cycle state.
 * @throws {CycleTransitionError} if the transition is not in the table — there
 *   are no implicit shortcuts (e.g. `intake → theory` is rejected).
 */
export function transition(state: CycleState, event: CycleEvent): CycleState {
  const next = TRANSITIONS[state][event];
  if (next === undefined) {
    throw new CycleTransitionError(state, event);
  }
  return next;
}
