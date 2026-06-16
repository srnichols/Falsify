/**
 * Shared types for the Falsify MCP server's dependency injection.
 *
 * The MCP shell is a thin transport adapter over the transport-free core. The
 * only things it needs injected are the live resources (memory) and the loaded
 * knowledge lens — both optional and faked in tests so no tool ever makes a real
 * network call or touches disk during the suite (Phase-2 plan, Forbidden actions).
 */

import type { QuantEntry } from '../domain/types.js';
import type { MemoryReader } from '../memory/openbrainClient.js';

/**
 * Re-exported from the core memory module so existing MCP-side imports keep
 * working. The interface itself now lives transport-neutrally next to
 * `MemoryWriter`, so the web transport can share the same recall surface.
 */
export type { MemoryReader };

/** Resources injected into the server at construction time. All optional. */
export interface FalsifyServerDeps {
  /** Memory backend for `falsify_recall`. Lazily defaulted to OpenBrain if absent. */
  memory?: MemoryReader;
  /** Quantitative-tier principles for the cross-cutting lens. Defaulted from the seed. */
  quantPrinciples?: QuantEntry[];
}
