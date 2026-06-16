/**
 * Shared types for the Falsify MCP server's dependency injection.
 *
 * The MCP shell is a thin transport adapter over the transport-free core. The
 * only things it needs injected are the live resources (memory) and the loaded
 * knowledge lens — both optional and faked in tests so no tool ever makes a real
 * network call or touches disk during the suite (Phase-2 plan, Forbidden actions).
 */

import type { QuantEntry } from '../domain/types.js';

/**
 * The narrow read surface `falsify_recall` depends on. Satisfied by
 * `OpenBrainMcpClient` in production and by a fake in tests.
 */
export interface MemoryReader {
  recall(query: string): Promise<unknown>;
}

/** Resources injected into the server at construction time. All optional. */
export interface FalsifyServerDeps {
  /** Memory backend for `falsify_recall`. Lazily defaulted to OpenBrain if absent. */
  memory?: MemoryReader;
  /** Quantitative-tier principles for the cross-cutting lens. Defaulted from the seed. */
  quantPrinciples?: QuantEntry[];
}
