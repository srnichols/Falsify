import { describe, it, expect } from 'vitest';
import { opDissent } from '../../src/cycle/dissent.js';
import type { DissentPositionInput } from '../../src/cycle/dissent.js';
import type { OpResult } from '../../src/cycle/operations.js';

function ok(result: OpResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.rule}: ${result.error}`);
  return result.payload;
}
function rule(result: OpResult): string {
  if (result.kind !== 'error') throw new Error('expected error');
  return result.rule;
}

const rising: DissentPositionInput = {
  label: 'model-a',
  source: 'model A',
  statement: 'Caffeine improves reaction time',
  predicts: 'reaction time falls after a 200mg dose',
  falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
};
const opposed: DissentPositionInput = {
  label: 'model-b',
  source: 'model B',
  statement: 'Caffeine worsens reaction time through jitter',
  predicts: 'reaction time rises after a 200mg dose',
  falsificationConditions: [
    { description: 'no drop in reaction time versus placebo' },
    { description: 'tremor amplitude unchanged on an accelerometer after dosing' },
  ],
};

describe('opDissent', () => {
  it('surfaces the disagreement, names the discriminating tests, and never picks a winner', () => {
    const p = ok(opDissent({ question: 'Does caffeine change reaction time?', positions: [rising, opposed] }));
    expect(p.winner).toBeNull();
    expect(p.directive).toMatch(/No winner/);
    const pair = (p.agreement as { pairs: { relation: string }[] }).pairs[0];
    expect(pair?.relation).toBe('opposed');
    expect((p.agreement as { summary: string }).summary).toBe('split');

    const tests = p.discriminatingTests as { position: string; tests: string[] }[];
    expect(tests.find((t) => t.position === 'model-a')?.tests).toEqual([]);
    expect(tests.find((t) => t.position === 'model-b')?.tests).toEqual([
      'tremor amplitude unchanged on an accelerometer after dosing',
    ]);
  });

  it('judges agreement from stated outcomes when every position gives one, not from wording', () => {
    const a: DissentPositionInput = { ...rising, outcome: { variable: 'mean reaction time', direction: 'decrease' } };
    // Worded almost identically to `a`, but the stated direction is the opposite.
    const b: DissentPositionInput = {
      ...rising,
      label: 'model-b',
      predicts: 'reaction time falls after a 200mg dose, ironically',
      outcome: { variable: 'reaction time', direction: 'increase' },
    };
    const opposedPair = ok(opDissent({ positions: [a, b] })).agreement as { pairs: { relation: string; basis: string }[]; summary: string };
    expect(opposedPair.pairs[0]).toMatchObject({ relation: 'opposed', basis: 'stated' });
    expect(opposedPair.summary).toBe('split');

    const c: DissentPositionInput = { ...opposed, label: 'model-c', outcome: { variable: 'mean reaction time', direction: 'decrease' } };
    const agreeing = ok(opDissent({ positions: [a, c] })).agreement as { pairs: { relation: string }[]; summary: string };
    expect(agreeing.pairs[0]?.relation).toBe('agree');
    expect(agreeing.summary).toBe('unanimous');

    const d: DissentPositionInput = { ...opposed, label: 'model-d', outcome: { variable: 'systolic blood pressure', direction: 'increase' } };
    const different = ok(opDissent({ positions: [a, d] })).agreement as { pairs: { relation: string }[]; summary: string };
    expect(different.pairs[0]?.relation).toBe('different-outcomes');
    expect(different.summary).toBe('split');
  });

  it('warns that agreement between models is a consensus signal, not an experiment', () => {
    const twin = { ...rising, label: 'model-c', source: 'model C' };
    const p = ok(opDissent({ positions: [rising, twin] }));
    expect((p.agreement as { summary: string }).summary).toBe('unanimous');
    expect(String(p.agreementWarning)).toMatch(/not an experiment/);
  });

  it('holds every position to the honesty rules and reports each failure', () => {
    const vacuous: DissentPositionInput = { ...opposed, label: 'lazy', falsificationConditions: [{ description: "if it's wrong" }] };
    const r = opDissent({ positions: [rising, vacuous] });
    expect(rule(r)).toBe('dissent:two-valid-positions-required');
    if (r.kind === 'error') expect(r.guidance).toContain('lazy');
  });

  it('still compares the valid ones and flags the invalid one when three are submitted', () => {
    const vacuous: DissentPositionInput = { ...opposed, label: 'lazy', falsificationConditions: [{ description: 'n/a' }] };
    const p = ok(opDissent({ positions: [rising, opposed, vacuous] }));
    expect(p.comparedCount).toBe(2);
    const positions = p.positions as { label: string; valid: boolean; issues: string[] }[];
    expect(positions.find((x) => x.label === 'lazy')?.valid).toBe(false);
  });

  it('rejects duplicate labels and flags consensus appeals inside a position', () => {
    expect(rule(opDissent({ positions: [rising, { ...opposed, label: 'MODEL-A' }] }))).toBe('dissent:duplicate-label');
    const appeal: DissentPositionInput = { ...opposed, statement: 'Experts agree caffeine worsens reaction time' };
    const p = ok(opDissent({ positions: [rising, appeal] }));
    const flagged = (p.positions as { label: string; consensusAppeal: boolean }[]).find((x) => x.label === 'model-b');
    expect(flagged?.consensusAppeal).toBe(true);
  });

  it('reports evidence strength per position when evidence is supplied, and the matching Contested entry', () => {
    const withEvidence: DissentPositionInput = {
      label: 'abiogenesis',
      statement: 'Life arose from non-living chemistry on early Earth',
      predicts: 'self-replicating chemistry emerges under early-Earth conditions',
      falsificationConditions: [{ description: 'no self-replicating molecules form in simulated early-Earth conditions' }],
      evidence: [{ observation: 'lab synthesis of nucleotides under prebiotic conditions', kind: 'experiment', source: 'Powner 2009', replicated: true }],
    };
    const other: DissentPositionInput = {
      label: 'panspermia',
      statement: 'Life was seeded from elsewhere in space',
      predicts: 'organic material of biological origin is found on meteorites',
      falsificationConditions: [{ description: 'no biologically specific molecules found in sampled meteorites' }],
    };
    const p = ok(opDissent({ question: 'What best explains the origin of life on Earth?', positions: [withEvidence, other] }));
    const positions = p.positions as { label: string; evidenceStrength?: string }[];
    expect(positions.find((x) => x.label === 'abiogenesis')?.evidenceStrength).toBeDefined();
    expect(positions.find((x) => x.label === 'panspermia')?.evidenceStrength).toBeUndefined();
    expect((p.contestedEntries as unknown[]).length).toBeGreaterThan(0);
    expect(p.winner).toBeNull();
  });
});
