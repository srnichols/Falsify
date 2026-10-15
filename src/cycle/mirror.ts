/**
 * Mirror inquiries — the opposite framing of a question, held to the same standard.
 *
 * A result on one side of a question means little if the other side was never given
 * the same chance to fail. `falsify_intake` accepts `mirrorOf: <sessionId>` to link a
 * new inquiry to the one it opposes. At Review, the two are compared: both reaching
 * "yes" on opposite framings is flagged, and so is a visible gap in rigor (falsifiers,
 * evidence, sources, search effort, contrary results). A theory with no completed
 * mirror cannot be rated "supported". None of this decides who is right; it makes an
 * uneven standard visible.
 */

import type { CycleContext } from './context.js';
import type { SessionRecord } from './session.js';

/** What one side of a mirror pair did, in comparable terms. */
export interface SideSummary {
  sessionId: string;
  question: string;
  state: string;
  verdict?: 'yes' | 'no';
  evidenceStrength?: string;
  falsifiers: number;
  hypothesesTried: number;
  evidenceItems: number;
  sourcesVerified: number;
  searchWords: number;
  contraryFound: number;
}

export interface MirrorAssessment {
  /** This inquiry is linked to an opposite framing. */
  linked: boolean;
  /** The opposite framing has reached an analysis, so a comparison is possible. */
  completed: boolean;
  partner?: SideSummary;
  /** Both framings reached "yes": they cannot both be right as stated. */
  bothYes: boolean;
  /** Visible differences in how hard each side was tested. */
  asymmetries: string[];
}

const words = (s: string | undefined): number => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

export function summarizeSide(session: SessionRecord): SideSummary {
  const a = session.analysis;
  return {
    sessionId: session.id,
    question: session.question,
    state: session.state,
    ...(a !== undefined ? { verdict: a.verdict } : {}),
    ...(a?.score !== undefined ? { evidenceStrength: a.score.evidenceStrength } : {}),
    falsifiers: session.hypothesis?.falsificationConditions.length ?? 0,
    hypothesesTried: session.refuted.length + (session.hypothesis !== undefined ? 1 : 0),
    evidenceItems: a?.evidence?.length ?? 0,
    sourcesVerified: a?.evidence?.filter((e) => e.sourceVerified === true).length ?? 0,
    searchWords: words(a?.evidenceSearch?.description),
    contraryFound: a?.evidenceSearch?.contraryFound ?? 0,
  };
}

/** Name the gaps between two sides; an empty list means nothing visible differs. */
export function compareSides(mine: SideSummary, theirs: SideSummary): string[] {
  const out: string[] = [];
  if (mine.falsifiers !== theirs.falsifiers) {
    out.push(`Falsifiers: this side stated ${mine.falsifiers}, the opposite framing ${theirs.falsifiers}.`);
  }
  if (Math.abs(mine.evidenceItems - theirs.evidenceItems) >= 2) {
    out.push(`Evidence items: ${mine.evidenceItems} here versus ${theirs.evidenceItems} on the opposite framing.`);
  }
  if (Math.abs(mine.sourcesVerified - theirs.sourcesVerified) >= 2) {
    out.push(`Verified sources: ${mine.sourcesVerified} here versus ${theirs.sourcesVerified} on the opposite framing.`);
  }
  const longer = Math.max(mine.searchWords, theirs.searchWords);
  const shorter = Math.min(mine.searchWords, theirs.searchWords);
  if (longer >= 20 && longer >= 2 * Math.max(shorter, 1)) {
    out.push(`Search effort: one side described a search ${longer} words long, the other ${shorter}.`);
  }
  if ((mine.contraryFound === 0) !== (theirs.contraryFound === 0)) {
    out.push(
      `Contrary results: ${mine.contraryFound} reported here, ${theirs.contraryFound} on the opposite framing. One side may not have looked as hard.`,
    );
  }
  if (Math.abs(mine.hypothesesTried - theirs.hypothesesTried) >= 2) {
    out.push(`Hypotheses tried: ${mine.hypothesesTried} here versus ${theirs.hypothesesTried} on the opposite framing.`);
  }
  return out;
}

/** Compare this session with its linked opposite framing. */
export function assessMirror(ctx: CycleContext | undefined, session: SessionRecord): MirrorAssessment {
  const partnerRecord = session.mirrorOf !== undefined ? ctx?.sessions?.get(session.mirrorOf) : undefined;
  if (partnerRecord === undefined) {
    return { linked: false, completed: false, bothYes: false, asymmetries: [] };
  }
  const mine = summarizeSide(session);
  const partner = summarizeSide(partnerRecord);
  const completed = partnerRecord.analysis !== undefined;
  return {
    linked: true,
    completed,
    partner,
    bothYes: completed && mine.verdict === 'yes' && partner.verdict === 'yes',
    asymmetries: completed ? compareSides(mine, partner) : [],
  };
}

/** Why a theory cannot be rated "supported", or undefined if the mirror does not stand in the way. */
export function mirrorCapReason(m: MirrorAssessment): string | undefined {
  if (!m.linked) {
    return 'No opposite framing was run (pass mirrorOf at intake), so this is a one-sided inquiry.';
  }
  if (!m.completed) {
    return 'The opposite framing was started but has not reached analysis, so it was not given the same test.';
  }
  if (m.bothYes) {
    return 'Both framings reached "yes". They cannot both be right as stated: re-examine the evidence and the wording of each.';
  }
  return undefined;
}

export type MirrorLinkResult = { ok: true } | { ok: false; rule: string; error: string; guidance: string };

/** Link a freshly created session to the one it opposes, in both directions. */
export function linkMirror(ctx: CycleContext | undefined, created: SessionRecord, otherId: string): MirrorLinkResult {
  const other = ctx?.sessions?.get(otherId);
  if (ctx?.sessions === undefined || other === undefined) {
    return {
      ok: false,
      rule: 'mirror:unknown-session',
      error: `No session '${otherId}' to mirror.`,
      guidance: 'Pass the sessionId of the inquiry whose opposite framing this is, or omit mirrorOf.',
    };
  }
  created.mirrorOf = other.id;
  other.mirrorOf = created.id;
  ctx.sessions.save(created);
  ctx.sessions.save(other);
  return { ok: true };
}

/** True if `otherId` can still be paired (it is unpaired). */
export function canPair(ctx: CycleContext | undefined, otherId: string): MirrorLinkResult {
  const other = ctx?.sessions?.get(otherId);
  if (other === undefined) {
    return {
      ok: false,
      rule: 'mirror:unknown-session',
      error: `No session '${otherId}' to mirror.`,
      guidance: 'Pass the sessionId of the inquiry whose opposite framing this is, or omit mirrorOf.',
    };
  }
  if (other.mirrorOf !== undefined) {
    return {
      ok: false,
      rule: 'mirror:already-paired',
      error: `Session '${otherId}' already has an opposite framing.`,
      guidance: 'Each inquiry has at most one mirror. Start the new inquiry without mirrorOf, or mirror the other one.',
    };
  }
  return { ok: true };
}
