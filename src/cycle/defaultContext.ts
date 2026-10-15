/**
 * The production {@link CycleContext}: sessions, notebook, and (when a key is
 * configured) the Corpus writer, all backed by the on-disk `.falsify` store.
 *
 * Only the real entrypoints (`falsify-mcp`, `falsify-web`) call this. Tests inject
 * their own collaborators so the suite never touches disk or the network.
 */

import { loadConfig } from '../config.js';
import { NotebookStore } from '../memory/notebook.js';
import { OpenBrainMcpClient } from '../memory/openbrainMcpClient.js';
import type { CycleContext } from './context.js';
import { DEFAULT_SESSION_DIR, SessionStore } from './session.js';

/** Build the disk-backed context; the Corpus is omitted if OpenBrain is not configured. */
export function createDefaultContext(): CycleContext {
  const ctx: CycleContext = {
    sessions: new SessionStore(DEFAULT_SESSION_DIR),
    notebook: new NotebookStore(),
  };
  try {
    const client = new OpenBrainMcpClient(loadConfig());
    ctx.corpus = client;
    ctx.memory = client;
  } catch {
    // No OPENBRAIN_KEY: surviving theories still reach the notebook, just not the corpus.
  }
  return ctx;
}
