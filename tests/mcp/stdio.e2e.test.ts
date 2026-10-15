/**
 * End-to-end over the real stdio transport, exactly as an MCP host (VS Code,
 * Claude, Copilot) launches it: `node dist/src/mcp/server.js`.
 *
 * It proves what the in-memory tests cannot: the built entrypoint starts, speaks
 * the protocol, persists a session to disk so an inquiry survives a server restart,
 * and records outcomes in the notebook. All state goes to a throwaway
 * FALSIFY_DATA_DIR and no OpenBrain key is passed, so nothing touches the user's
 * notebook or the network.
 *
 * Skipped when the project has not been built (`npm run build`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ENTRYPOINT = resolve(process.cwd(), 'dist', 'src', 'mcp', 'server.js');
const built = existsSync(ENTRYPOINT);

type ToolResult = { content: Array<{ type: string; text?: string }> };

function payloadOf(result: ToolResult): Record<string, unknown> {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('no text content in tool result');
  return JSON.parse(block.text) as Record<string, unknown>;
}

const REVIEW = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

describe.skipIf(!built)('falsify-mcp over stdio', () => {
  let dataDir: string;
  const open: Client[] = [];

  async function connect(): Promise<Client> {
    const client = new Client({ name: 'stdio-e2e', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ENTRYPOINT],
      cwd: process.cwd(),
      env: { FALSIFY_DATA_DIR: dataDir },
      stderr: 'ignore',
    });
    await client.connect(transport);
    open.push(client);
    return client;
  }

  const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
    payloadOf((await client.callTool({ name, arguments: args })) as ToolResult);

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'falsify-stdio-'));
  });

  afterAll(async () => {
    await Promise.all(open.map((c) => c.close()));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves all ten tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'falsify_analyze',
        'falsify_dissent',
        'falsify_experiment',
        'falsify_hypothesize',
        'falsify_intake',
        'falsify_outcome',
        'falsify_recall',
        'falsify_related',
        'falsify_review',
        'falsify_verify_source',
      ].sort(),
    );
  }, 30_000);

  it('keeps an inquiry across a server restart and records the theory', async () => {
    const first = await connect();
    const intake = await call(first, 'falsify_intake', { question: 'Does a 200mg caffeine dose lower reaction time?' });
    const sessionId = intake.sessionId as string;
    expect(sessionId).toBeTruthy();

    const hyp = await call(first, 'falsify_hypothesize', {
      statement: 'Caffeine lowers reaction time',
      predicts: 'faster responses after the dose',
      falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
      sessionId,
    });
    expect(hyp.cycleState).toBe('experiment');
    await first.close();

    // A brand-new server process, same data directory: the session must still be there,
    // and still refuses to confirm a theory that has no yes verdict behind it.
    const second = await connect();
    const skipped = await call(second, 'falsify_review', { ...REVIEW, outcome: 'confirm', sessionId });
    expect(skipped.rule).toBe('review:yes-verdict-required');

    const exp = await call(second, 'falsify_experiment', {
      decisiveEvidence: ['blinded placebo-controlled reaction-time test'],
      couldFail: true,
      sessionId,
    });
    expect(exp.cycleState).toBe('analysis');

    const early = await call(second, 'falsify_review', { ...REVIEW, outcome: 'confirm', sessionId });
    expect(early.rule).toBe('review:yes-verdict-required');

    const analysis = await call(second, 'falsify_analyze', {
      verdict: 'yes',
      evidence: [{ observation: 'randomized trial showed faster responses', kind: 'experiment', source: 'Trial A', sampleSize: 400, pValue: 0.004, outcomesTested: 1 }],
      evidenceSearch: { description: 'Searched PubMed and the trial registry for caffeine trials', contraryFound: 0 },
      sessionId,
    });
    expect((analysis.claimScore as { evidenceStrength: string }).evidenceStrength).toBe('moderate');

    const review = await call(second, 'falsify_review', { ...REVIEW, outcome: 'confirm', sessionId });
    expect(review.cycleState).toBe('theory');
    expect(review.cycleVerified).toBe(true);

    expect(readdirSync(join(dataDir, 'sessions'))).toContain(`${sessionId}.json`);
    const notebook = readFileSync(join(dataDir, 'notebook', 'falsify.jsonl'), 'utf8');
    expect(notebook).toContain('"kind":"theory"');
    expect(notebook).toContain('Caffeine lowers reaction time');
  }, 60_000);

  it('answers related and dissent over the wire', async () => {
    const client = await connect();
    const related = await call(client, 'falsify_related', { claim: 'Stomach ulcers are caused by stress and spicy food' });
    expect((related.matches as { tier: string }[]).some((m) => m.tier === 'refuted')).toBe(true);
    expect(related.semantic).toBe('unavailable');

    const dissent = await call(client, 'falsify_dissent', {
      positions: [
        { label: 'a', statement: 'Caffeine improves reaction time', predicts: 'reaction time falls', falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }] },
        { label: 'b', statement: 'Caffeine worsens reaction time', predicts: 'reaction time rises', falsificationConditions: [{ description: 'tremor unchanged on an accelerometer after dosing' }] },
      ],
    });
    expect(dissent.winner).toBeNull();
  }, 30_000);
});
