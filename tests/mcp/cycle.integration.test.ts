/**
 * Slice 5 end-to-end test: drive the entire Cycle of Scientific Enterprise through
 * one MCP `Client` — including the mandatory No-branch loop and the review-gated
 * finalization of a Theory. Quant principles are injected so no disk/network is hit.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFalsifyServer } from '../../src/mcp/server.js';
import type { QuantEntry } from '../../src/domain/types.js';

const PRINCIPLES: QuantEntry[] = [
  {
    id: 'q-noop',
    principle: 'noop',
    statement: 'no trigger',
    triggers: ['zzzznotreal'],
    failure_guarded: 'none',
  },
];

function payloadOf(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('no text content in tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('full cycle over MCP — Slice 5', () => {
  it('drives intake → hypothesize → experiment → analyze(no) → review(revise) → ... → theory', async () => {
    const server = createFalsifyServer({ quantPrinciples: PRINCIPLES });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);

    try {
      // Intake — a falsifiable question advances to hypothesis.
      const intake = payloadOf(
        (await client.callTool({
          name: 'falsify_intake',
          arguments: { question: 'Does a 200mg caffeine dose lower reaction time?' },
        })) as never,
      );
      expect(intake.cycleState).toBe('hypothesis');

      // Hypothesize — advances to experiment.
      const hyp1 = payloadOf(
        (await client.callTool({
          name: 'falsify_hypothesize',
          arguments: {
            statement: 'Caffeine lowers reaction time.',
            predicts: 'Reaction time drops after 200mg.',
            falsificationConditions: [{ description: 'Reaction time is unchanged or rises.' }],
            cycleState: intake.cycleState,
          },
        })) as never,
      );
      expect(hyp1.cycleState).toBe('experiment');

      // Experiment — advances to analysis.
      const exp1 = payloadOf(
        (await client.callTool({
          name: 'falsify_experiment',
          arguments: {
            decisiveEvidence: ['Blinded before/after reaction-time measurements.'],
            couldFail: true,
            cycleState: hyp1.cycleState,
          },
        })) as never,
      );
      expect(exp1.cycleState).toBe('analysis');

      // Analyze (No) — takes the mandatory No branch to review.
      const ana1 = payloadOf(
        (await client.callTool({
          name: 'falsify_analyze',
          arguments: {
            verdict: 'no',
            evidenceCited: ['Reaction time did not change.'],
            cycleState: exp1.cycleState,
          },
        })) as never,
      );
      expect(ana1.cycleState).toBe('review');

      // Review (revise) — loops back to hypothesis.
      const rev1 = payloadOf(
        (await client.callTool({
          name: 'falsify_review',
          arguments: {
            q1Methods: 'Methods were sound.',
            q2Hypothesis: 'Dose was too low; revise upward.',
            q3Theory: 'Theory holds.',
            outcome: 'revise',
            cycleState: ana1.cycleState,
          },
        })) as never,
      );
      expect(rev1.cycleState).toBe('hypothesis');

      // Second pass: hypothesize → experiment → analyze(yes) → review(confirm) → theory.
      const hyp2 = payloadOf(
        (await client.callTool({
          name: 'falsify_hypothesize',
          arguments: {
            statement: 'A higher caffeine dose lowers reaction time.',
            predicts: 'Reaction time drops after 400mg.',
            falsificationConditions: [{ description: 'Reaction time is unchanged or rises.' }],
            cycleState: rev1.cycleState,
          },
        })) as never,
      );
      expect(hyp2.cycleState).toBe('experiment');

      const exp2 = payloadOf(
        (await client.callTool({
          name: 'falsify_experiment',
          arguments: {
            decisiveEvidence: ['Blinded before/after reaction-time measurements at 400mg.'],
            couldFail: true,
            cycleState: hyp2.cycleState,
          },
        })) as never,
      );
      expect(exp2.cycleState).toBe('analysis');

      // Analyze (Yes) — NOT final; review required.
      const ana2 = payloadOf(
        (await client.callTool({
          name: 'falsify_analyze',
          arguments: {
            verdict: 'yes',
            evidenceCited: ['Reaction time dropped significantly.'],
            cycleState: exp2.cycleState,
          },
        })) as never,
      );
      expect(ana2.reviewRequired).toBe(true);
      expect(ana2.cycleState).toBe('analysis');

      // Review (confirm) — finalizes the Theory (terminal).
      const rev2 = payloadOf(
        (await client.callTool({
          name: 'falsify_review',
          arguments: {
            q1Methods: 'Methods were sound and blinded.',
            q2Hypothesis: 'Hypothesis matched the data.',
            q3Theory: 'Theory is supported.',
            outcome: 'confirm',
            cycleState: ana2.cycleState,
          },
        })) as never,
      );
      expect(rev2.cycleState).toBe('theory');
      expect(rev2.legalNext).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
