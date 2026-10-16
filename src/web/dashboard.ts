/**
 * Read-only data for the dashboard: server status, session summaries and the outcome
 * report. Pure functions over the injected context, so they are unit-testable without
 * a socket. Nothing here changes a verdict or a record.
 */

import { readFileSync } from 'node:fs';
import type { CycleContext } from '../cycle/context.js';
import type { SessionRecord } from '../cycle/session.js';
import { assessMirror } from '../cycle/mirror.js';
import type { MirrorAssessment } from '../cycle/mirror.js';
import { DEFAULT_WEIGHTS } from '../rules/claimScore.js';
import { evaluateOutcomes } from '../rules/outcomeCalibration.js';
import type { KnowledgeFiles } from '../knowledge/browse.js';
import { findPackageAsset } from '../paths.js';

/** The MCP tools, in cycle order. A test checks this against what the server registers. */
export const MCP_TOOL_NAMES = [
  'falsify_intake',
  'falsify_related',
  'falsify_hypothesize',
  'falsify_experiment',
  'falsify_analyze',
  'falsify_review',
  'falsify_verify_source',
  'falsify_dissent',
  'falsify_recall',
  'falsify_outcome',
] as const;

export interface SessionSummary {
  id: string;
  question: string;
  state: string;
  verdict?: 'yes' | 'no';
  evidenceStrength?: string;
  epistemicStatus?: string;
  statusCap?: string;
  mirrorOf?: string;
  revisions: number;
  evidenceItems: number;
  createdAt: string;
  updatedAt: string;
}

export function summarizeSession(session: SessionRecord): SessionSummary {
  const analysis = session.analysis;
  return {
    id: session.id,
    question: session.question,
    state: session.state,
    ...(analysis !== undefined ? { verdict: analysis.verdict } : {}),
    ...(analysis?.score !== undefined ? { evidenceStrength: analysis.score.evidenceStrength } : {}),
    ...(session.epistemicStatus !== undefined ? { epistemicStatus: session.epistemicStatus } : {}),
    ...(session.statusCap !== undefined ? { statusCap: session.statusCap } : {}),
    ...(session.mirrorOf !== undefined ? { mirrorOf: session.mirrorOf } : {}),
    revisions: session.refuted.length,
    evidenceItems: analysis?.evidence?.length ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function listSessionSummaries(ctx: CycleContext): SessionSummary[] {
  return (ctx.sessions?.list() ?? []).map(summarizeSession);
}

/** One session with its mirror comparison, for the detail screen. */
export function sessionDetail(ctx: CycleContext, session: SessionRecord): { session: SessionRecord; mirror?: MirrorAssessment } {
  return session.mirrorOf !== undefined ? { session, mirror: assessMirror(ctx, session) } : { session };
}

function packageVersion(): string {
  try {
    const path = findPackageAsset('package.json');
    if (path === undefined) return 'unknown';
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const count = <T>(items: readonly T[], key: (item: T) => string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

export function getStatus(ctx: CycleContext, files: KnowledgeFiles): Record<string, unknown> {
  const sessions = ctx.sessions?.list() ?? [];
  const byTier: Record<string, number> = {};
  const byField: Record<string, number> = {};
  let total = 0;
  for (const [tier, file] of Object.entries(files)) {
    byTier[tier] = file.entries.length;
    total += file.entries.length;
    if (tier === 'quantitative') continue;
    for (const entry of file.entries) {
      const domain = 'domain' in entry && typeof entry.domain === 'string' ? entry.domain : undefined;
      if (domain !== undefined) {
        const f = domain.split('/')[0] ?? domain;
        byField[f] = (byField[f] ?? 0) + 1;
      }
    }
  }
  const outcomes = ctx.outcomes?.current() ?? [];
  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  return {
    version: packageVersion(),
    tools: MCP_TOOL_NAMES,
    corpus: { total, byTier, byField },
    settings: {
      requireSession: ctx.requireSession === true,
      openBrain: ctx.corpus !== undefined || ctx.memory !== undefined,
      judge: ctx.judge !== undefined ? { enabled: true, model: ctx.judge.model } : { enabled: false },
      embeddings: { enabled: ctx.embeddings !== undefined },
      weights,
    },
    sessions: {
      total: sessions.length,
      byState: count(sessions, (s) => s.state),
      byStatus: count(sessions, (s) => s.epistemicStatus),
    },
    outcomes: { available: ctx.outcomes !== undefined, total: outcomes.length },
  };
}

export function getOutcomes(ctx: CycleContext): Record<string, unknown> {
  if (ctx.outcomes === undefined) {
    return { available: false, message: 'Outcome tracking is not configured on this server.' };
  }
  const records = ctx.outcomes.current();
  return { available: true, records, history: ctx.outcomes.history().length, report: evaluateOutcomes(records) };
}
