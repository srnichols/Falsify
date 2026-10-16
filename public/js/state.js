/* State shared between screens: which inquiry is open, and the last thing the server said. */

import { post } from './api.js';

export const state = {
  /** The open inquiry's session record, or null before intake. */
  session: null,
  /** The opposite-framing comparison for the open session, if linked. */
  mirror: null,
  /** The last operation's result, shown in the result panel: {step, json, ok}. */
  last: null,
  /** Knowledge entries the hypothesis step matched, offered as references in analysis. */
  matches: [],
  /** Values to pre-fill the next intake (set by "run the opposite framing"). */
  prefill: null,
  /** Session to pre-select when recording an outcome. */
  outcomeFor: null,
};

/** Load a session by id into the shared state. Returns the response. */
export async function loadSession(id) {
  const res = await post('/api/session', { sessionId: id });
  if (res.ok) {
    state.session = res.json.session;
    state.mirror = res.json.mirror ?? null;
  }
  return res;
}

/** Forget the open inquiry (start fresh). */
export function resetInquiry() {
  state.session = null;
  state.mirror = null;
  state.last = null;
  state.matches = [];
}

/** Which step of the cycle the open inquiry is at. A recorded "yes" waits for review. */
export function currentStep(session = state.session) {
  if (!session) return 'intake';
  if (session.state === 'analysis' && session.analysis?.verdict === 'yes') return 'review';
  return session.state;
}
