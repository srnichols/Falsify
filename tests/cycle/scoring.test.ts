import { describe, it, expect, vi } from 'vitest';
import { opIntake, opHypothesize, opExperiment, opAnalyze, opReview } from '../../src/cycle/operations.js';
import type { OpResult } from '../../src/cycle/operations.js';
import type { CycleContext } from '../../src/cycle/context.js';
import { SessionStore } from '../../src/cycle/session.js';
import type { BrainMemory, MemoryWriter } from '../../src/memory/openbrainClient.js';
import { REPLICATION_DOI, SEARCH, verifyReplication } from '../helpers/evidence.js';

function ok(result: OpResult): Record<string, unknown> {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.rule}: ${result.error}`);
  return result.payload;
}
function rule(result: OpResult): string {
  if (result.kind !== 'error') throw new Error('expected error');
  return result.rule;
}

const ANSWERS = {
  q1Methods: 'The protocol was blinded and sound.',
  q2Hypothesis: 'The hypothesis was well formed.',
  q3Theory: 'The underlying theory still holds.',
};

function setup(statement: string): { ctx: CycleContext; sessionId: string; saved: BrainMemory[] } {
  const saved: BrainMemory[] = [];
  const corpus: MemoryWriter = {
    save: vi.fn(async (m: BrainMemory) => {
      saved.push(m);
      return { saved: true, queued: false, drained: 0 };
    }),
  };
  const ctx: CycleContext = { sessions: new SessionStore(), corpus };
  const sessionId = ok(opIntake({ question: 'Does a 200mg caffeine dose lower reaction time?' }, ctx)).sessionId as string;
  ok(
    opHypothesize(
      {
        statement,
        predicts: 'faster responses after the dose',
        falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
        sessionId,
      },
      [],
      ctx,
    ),
  );
  ok(opExperiment({ couldFail: true, decisiveEvidence: ['blinded placebo-controlled reaction-time test'], sessionId }, ctx));
  return { ctx, sessionId, saved };
}

describe('scored analysis', () => {
  it('returns a claim score built from structured evidence and records it with the theory', async () => {
    const { ctx, sessionId, saved } = setup('Caffeine lowers reaction time');
    await verifyReplication(ctx, sessionId);
    const p = ok(
      opAnalyze(
        {
          verdict: 'yes',
          evidence: [
            {
              observation: 'randomized trial showed faster responses',
              kind: 'experiment',
              source: 'Trial A',
              sampleSize: 400,
              pValue: 0.004,
              outcomesTested: 1,
              replicated: true,
              replicationDoi: REPLICATION_DOI,
            },
          ],
          evidenceSearch: SEARCH,
          sessionId,
        },
        ctx,
      ),
    );
    const report = p.claimScore as { evidenceStrength: string; score: number };
    expect(report.evidenceStrength).toBe('strong');

    ok(opReview({ ...ANSWERS, outcome: 'confirm', sessionId }, ctx));
    expect(saved[0]?.metadata?.evidence_strength).toBe('strong');
    expect(saved[0]?.metadata?.claim_score).toBe(report.score);
  });

  it('labels plain-text evidence weak or moderate rather than strong', () => {
    const { ctx, sessionId } = setup('Caffeine lowers reaction time');
    const p = ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell after the dose'], evidenceSearch: SEARCH, sessionId }, ctx));
    expect((p.claimScore as { evidenceStrength: string }).evidenceStrength).not.toBe('strong');
  });

  it('does not score a stateless analysis, which has no locked hypothesis to judge', () => {
    const p = ok(opAnalyze({ verdict: 'yes', evidenceCited: ['reaction time fell after the dose'] }));
    expect(p.claimScore).toBeUndefined();
  });

  it('treats relabelled consensus as consensus', () => {
    const { ctx, sessionId } = setup('Caffeine lowers reaction time');
    const r = opAnalyze(
      { verdict: 'yes', evidence: [{ observation: 'experts agree it works', kind: 'experiment', source: 'Panel' }], sessionId },
      ctx,
    );
    expect(rule(r)).toBe('analysis:consensus-is-not-evidence');
  });
});

describe('knowledge references', () => {
  const claim = 'Energy can be created from nothing in a closed system';

  it('rejects unknown entries and tiers that carry no support weight', () => {
    const { ctx, sessionId } = setup(claim);
    expect(
      rule(opAnalyze({ verdict: 'no', evidenceCited: ['output equalled input'], knowledgeRefs: [{ id: 'nope.nothing', relation: 'supports' }], sessionId }, ctx)),
    ).toBe('analysis:unknown-knowledge-ref');
    expect(
      rule(
        opAnalyze(
          { verdict: 'no', evidenceCited: ['output equalled input'], knowledgeRefs: [{ id: 'refuted.engineering.perpetual_motion', relation: 'conflicts' }], sessionId },
          ctx,
        ),
      ),
    ).toBe('analysis:knowledge-ref-tier');
  });

  it('refuses a yes that conflicts with a Bedrock law on observation alone', () => {
    const { ctx, sessionId } = setup(claim);
    const r = opAnalyze(
      {
        verdict: 'yes',
        evidenceCited: ['the output meter read higher than the input meter'],
        knowledgeRefs: [{ id: 'bedrock.energy.conservation', relation: 'conflicts' }],
        sessionId,
      },
      ctx,
    );
    expect(rule(r)).toBe('analysis:decisive-evidence-required');
  });

  it('lets a conflicting yes through only with a sourced experiment, and flags it', () => {
    const { ctx, sessionId } = setup(claim);
    const p = ok(
      opAnalyze(
        {
          verdict: 'yes',
          evidence: [{ observation: 'calorimetry showed output above input in a sealed run', kind: 'experiment', source: 'Lab notebook 12', replicated: true }],
          knowledgeRefs: [{ id: 'bedrock.energy.conservation', relation: 'conflicts' }],
          evidenceSearch: SEARCH,
          sessionId,
        },
        ctx,
      ),
    );
    expect((p.claimScore as { conflictsWithKnowledge: boolean }).conflictsWithKnowledge).toBe(true);
  });

  it('does not demand decisive evidence for a no verdict that conflicts with the law', () => {
    const { ctx, sessionId } = setup(claim);
    const p = ok(
      opAnalyze(
        {
          verdict: 'no',
          evidenceCited: ['output equalled input in the calorimeter'],
          knowledgeRefs: [{ id: 'bedrock.energy.conservation', relation: 'supports' }],
          sessionId,
        },
        ctx,
      ),
    );
    expect(p.cycleState).toBe('review');
  });
});
