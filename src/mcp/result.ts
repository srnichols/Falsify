/**
 * Tool-result helpers — the single place that builds the MCP `CallToolResult`
 * shape so every `falsify_*` tool answers identically (Phase-2 plan, Decision 7).
 *
 * A Falsify tool never crashes the transport on a bad draft: an honesty-rule
 * violation or an illegal cycle move returns a structured `isError` result, not a
 * thrown exception. The payload is always JSON so the host agent (and later the
 * web UI) can read it mechanically.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { legalEvents, transition, CycleTransitionError } from '../cycle/stateMachine.js';
import type { CycleEvent } from '../cycle/stateMachine.js';
import type { CycleState } from '../domain/types.js';

/** A successful result carrying an arbitrary JSON payload. */
export function ok(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * A structured failure. `rule` names the discipline that rejected the draft (e.g.
 * `honesty:falsification-condition-required`) so a host agent can self-correct.
 */
export function fail(error: string, rule: string, guidance: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error, rule, guidance }) }],
    isError: true,
  };
}

/**
 * A success that also reports where the cycle now stands: the resulting state and
 * the events that are legal from it. This is how the stateless server threads the
 * cycle back to the caller (Phase-2 plan, Decision 3).
 */
export function withState(payload: Record<string, unknown>, state: CycleState): CallToolResult {
  return ok({ ...payload, cycleState: state, legalNext: legalEvents(state) });
}

/**
 * Apply a cycle event, converting an illegal transition into a structured failure
 * instead of a thrown error. Returns either the next state or a ready-to-return
 * `CallToolResult` describing the rejection.
 */
export function advance(
  state: CycleState,
  event: CycleEvent,
): { next: CycleState } | { error: CallToolResult } {
  try {
    return { next: transition(state, event) };
  } catch (err) {
    if (err instanceof CycleTransitionError) {
      return {
        error: fail(
          err.message,
          'cycle:illegal-transition',
          `From state '${state}' the legal events are: ${legalEvents(state).join(', ') || '(none — terminal)'}.`,
        ),
      };
    }
    throw err;
  }
}
