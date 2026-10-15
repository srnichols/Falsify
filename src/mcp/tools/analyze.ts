/**
 * `falsify_analyze` — the MCP adapter for the Analysis step (DESIGN.md §3).
 *
 * All discipline lives in {@link opAnalyze} — including the mandatory
 * review-on-Yes rule; this file declares the input schema and maps the result.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CycleStateSchema } from '../../domain/schemas.js';
import { opAnalyze } from '../../cycle/operations.js';
import { adviseAnalysis } from '../../cycle/advice.js';
import type { CycleContext } from '../../cycle/context.js';
import { EvidenceSchema } from '../../domain/evidence.js';
import { toCallToolResult } from '../result.js';

/** The validated input shape for `falsify_analyze`. */
const inputShape = {
  verdict: z.enum(['yes', 'no']),
  evidenceCited: z.array(z.string()).optional(),
  evidence: z.array(EvidenceSchema).optional(),
  knowledgeRefs: z
    .array(z.object({ id: z.string().min(1), relation: z.enum(['supports', 'conflicts']) }))
    .optional(),
  sessionId: z.string().optional(),
  cycleState: CycleStateSchema.optional(),
} as const;

/** Register `falsify_analyze` on the server. */
export function registerAnalyze(server: McpServer, ctx?: CycleContext): void {
  server.registerTool(
    'falsify_analyze',
    {
      description:
        'Compare the data to the prediction: verdict yes or no, citing the observations it rests ' +
        'on. Use evidenceCited for plain observations or evidence for structured items (kind, source, ' +
        'sampleSize, effectSize, pValue, replicated) \u2014 structured evidence is what earns a strong ' +
        'claimScore. Appeals to consensus are not evidence and are refused. knowledgeRefs links the ' +
        'claim to Bedrock/Established entries it supports or conflicts with (ids from falsify_hypothesize); ' +
        'a yes that conflicts with one needs a sourced experiment or statistical result. A "no" takes ' +
        'the mandatory No branch to Review. A "yes" is NOT final \u2014 Review is mandatory even on a yes, ' +
        'so the result reports reviewRequired and you must call falsify_review (outcome: confirm) to ' +
        'finalize a Theory. Pass the sessionId from falsify_intake.',
      inputSchema: inputShape,
    },
    async (args) =>
      toCallToolResult(
        await adviseAnalysis(
          opAnalyze(
            {
              verdict: args.verdict,
              evidenceCited: args.evidenceCited,
              evidence: args.evidence,
              knowledgeRefs: args.knowledgeRefs,
              sessionId: args.sessionId,
              cycleState: args.cycleState,
            },
            ctx,
          ),
          ctx,
        ),
      ),
  );
}
