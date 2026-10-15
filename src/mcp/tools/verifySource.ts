/**
 * `falsify_verify_source` — the MCP adapter for source verification.
 *
 * All logic lives in {@link opVerifySource}; this file declares the input schema
 * and maps the neutral result onto MCP's `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { opVerifySource } from '../../cycle/verify.js';
import type { CycleContext } from '../../cycle/context.js';
import { toCallToolResult } from '../result.js';

const inputShape = {
  doi: z.string().min(1, 'a DOI is required'),
  sessionId: z.string().optional(),
} as const;

/** Register `falsify_verify_source` on the server. */
export function registerVerifySource(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_verify_source',
    {
      description:
        'Check that a DOI you cite as evidence is a real publication (looks it up in the public ' +
        'Crossref registry; only the DOI is sent). Returns its title, venue and year so you can see ' +
        'it is the work you mean. With a sessionId, evidence that carries this DOI earns full source ' +
        'credit in falsify_analyze instead of the small credit for a typed-in source. It confirms the ' +
        'work exists, not that it supports your claim.',
      inputSchema: inputShape,
    },
    async (args) => toCallToolResult(await opVerifySource({ doi: args.doi, sessionId: args.sessionId }, ctx)),
  );
}
