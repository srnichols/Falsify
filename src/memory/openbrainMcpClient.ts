/**
 * OpenBrain MCP client — the *hosted* Corpus backend (DESIGN.md §5).
 *
 * The public Open Brain deployment (`brain.planforge.software`) exposes **only**
 * its MCP-over-SSE transport on 443. The REST API (`POST /memories`, with a
 * structured `metadata` field) runs on a separate, non-public port. So to write
 * to the hosted brain we speak MCP: connect to `/sse` with the `x-brain-key`
 * header, then call the `capture_thought` / `search_thoughts` tools.
 *
 * Two consequences shape this module:
 *
 *  1. **No structured metadata field.** `capture_thought` accepts only
 *     `content`, `project`, `source`. We therefore *fold* a memory's metadata
 *     into a readable, searchable block appended to its `content` (see
 *     {@link foldMetadataIntoContent}) so nothing is lost on the way in.
 *  2. **Same graceful degradation as the REST client.** A save that cannot
 *     reach the brain is written to the offline queue and replayed later; the
 *     `x-brain-key` value never appears in an error, log line, or queue file.
 */

import type { FalsifyConfig } from '../config.js';
import type { BrainMemory, RecallQuery, SaveResult, MemoryWriter } from './openbrainClient.js';
import { DEFAULT_QUEUE_DIR } from './openbrainClient.js';
import { OfflineQueue } from './offlineQueue.js';

/** Tool arguments for a single `capture_thought` call. */
interface CaptureArgs {
  content: string;
  project: string;
  source?: string;
}

/**
 * A live MCP session, narrowed to the two operations Falsify needs. Abstracted
 * so tests can inject a fake session with no network.
 */
export interface McpSession {
  /** Invoke a tool; resolves with its (already unwrapped) result, throws on tool error. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Tear down the session. */
  close(): Promise<void>;
}

/** Establishes a fresh {@link McpSession}. */
export type McpConnect = () => Promise<McpSession>;

export interface OpenBrainMcpClientOptions {
  /** Directory for the offline queue. Defaults to `.falsify/queue`. */
  queueDir?: string;
  /** Session factory. Defaults to a real MCP-over-SSE connection. */
  connectImpl?: McpConnect;
  /**
   * Minimum delay (ms) inserted before each network capture, to stay under the
   * brain's edge rate limit. Defaults to `0` (no throttle).
   */
  throttleMs?: number;
  /**
   * How many times to retry a *transient* failure (HTTP 429 / 5xx / dropped
   * connection) with exponential backoff before giving up. Defaults to `5`.
   */
  maxRetries?: number;
}

/** A transient failure worth retrying with backoff — rate limit, server blip, or dropped socket. */
function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /HTTP 429|HTTP 5\d\d|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(message);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Render a memory's structured metadata into a deterministic, human- and
 * search-friendly text block, then append it to the content. This is how the
 * tier / falsifiability / provenance data survives a transport that has no
 * metadata field of its own.
 */
export function foldMetadataIntoContent(memory: BrainMemory): string {
  const meta = memory.metadata;
  if (!meta || Object.keys(meta).length === 0) return memory.content;

  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    const rendered =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    lines.push(`${key}: ${rendered}`);
  }
  if (lines.length === 0) return memory.content;

  return `${memory.content}\n\n— Falsify knowledge seed —\n${lines.join('\n')}`;
}

export class OpenBrainMcpClient implements MemoryWriter {
  private readonly queue: OfflineQueue;
  private readonly connectImpl: McpConnect;
  private readonly throttleMs: number;
  private readonly maxRetries: number;
  private session: McpSession | undefined;

  constructor(
    private readonly config: FalsifyConfig,
    options: OpenBrainMcpClientOptions = {},
  ) {
    this.queue = new OfflineQueue(options.queueDir ?? DEFAULT_QUEUE_DIR);
    this.connectImpl = options.connectImpl ?? (() => this.defaultConnect());
    this.throttleMs = options.throttleMs ?? 0;
    this.maxRetries = options.maxRetries ?? 5;
  }

  /**
   * Persist a memory via the `capture_thought` tool. On any transport failure
   * the (key-free) tool arguments are queued locally and
   * `{ saved:false, queued:true }` is returned — the caller is never blocked. On
   * success, any previously-queued payloads are drained first.
   */
  async save(memory: BrainMemory): Promise<SaveResult> {
    const args: CaptureArgs = {
      content: foldMetadataIntoContent(memory),
      project: this.config.project,
      ...(memory.source !== undefined ? { source: memory.source } : {}),
    };

    try {
      await this.capture(args);
    } catch {
      this.queue.enqueue(args);
      return { saved: false, queued: true, drained: 0 };
    }

    const drained = await this.queue.drain((payload) => this.capture(payload as CaptureArgs));
    return { saved: true, queued: false, drained };
  }

  /** Semantic recall via `search_thoughts`. Throws on failure (no offline fallback). */
  async recall(query: RecallQuery): Promise<unknown[]> {
    const session = await this.ensureSession();
    const result = await session.callTool('search_thoughts', {
      query: query.query,
      project: this.config.project,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object' && Array.isArray((result as { results?: unknown[] }).results)) {
      return (result as { results: unknown[] }).results;
    }
    return [];
  }

  /** Number of payloads currently waiting in the offline queue. */
  pendingCount(): number {
    return this.queue.count();
  }

  /** Close the underlying MCP session, if one is open. */
  async close(): Promise<void> {
    if (this.session) {
      const session = this.session;
      this.session = undefined;
      await session.close();
    }
  }

  private async capture(args: CaptureArgs): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.throttleMs > 0) await sleep(this.throttleMs);
      try {
        const session = await this.ensureSession();
        await session.callTool('capture_thought', args as unknown as Record<string, unknown>);
        return;
      } catch (err) {
        if (attempt >= this.maxRetries || !isTransient(err)) throw err;
        // Back off exponentially (1s, 2s, 4s, …) before retrying the same call.
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  private async ensureSession(): Promise<McpSession> {
    if (!this.session) {
      this.session = await this.connectImpl();
    }
    return this.session;
  }

  /** Build a real MCP-over-SSE session against the configured brain. */
  private async defaultConnect(): Promise<McpSession> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');

    const key = this.config.brainKey;
    const sseUrl = new URL('/sse', this.config.brainRestBase);

    // Inject the key on BOTH the SSE GET (via eventSourceInit.fetch) and the
    // POST /messages calls. Merge through `new Headers()` rather than object
    // spread: the SDK hands us a `Headers` instance, and spreading one drops the
    // SDK's own `content-type: application/json` (the body would then be sent as
    // text/plain and rejected with HTTP 400). The key lives only in headers —
    // never in a URL, error, or log line.
    const authedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set('x-brain-key', key);
      return fetch(input, { ...init, headers });
    };

    const transport = new SSEClientTransport(sseUrl, {
      eventSourceInit: { fetch: authedFetch as unknown as typeof fetch },
      requestInit: { headers: { 'x-brain-key': key } },
      fetch: authedFetch as never,
    });

    const client = new Client(
      { name: 'falsify-seed', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    return {
      async callTool(name, args) {
        const res = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content?: Array<{ type: string; text?: string }>;
        };
        if (res.isError) {
          // The tool reported failure — surface as a throw so save() can queue.
          throw new Error(`MCP tool "${name}" returned an error result.`);
        }
        const text = res.content?.find((c) => c.type === 'text')?.text;
        if (text) {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
        return res;
      },
      async close() {
        await client.close();
      },
    };
  }
}
