/**
 * Source verification — turns an asserted citation into a checked one.
 *
 * An evidence item's `source` is a string anyone can type. A DOI can be looked up:
 * Crossref's public registry says whether it exists and what it is. This confirms
 * that the work is real and shows its title, venue and year so a human can see
 * whether it is the work being claimed. It does NOT confirm that the work says
 * what the evidence claims; that stays a human judgement.
 *
 * Only the DOI is sent, to a public API with no key. Failures degrade to
 * "unverified", never to an error that blocks the cycle.
 */

import { normalizeDoi } from '../domain/evidence.js';

/** The slice of `fetch` this module needs, so tests can inject a fake. */
export type SourceFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** What a successful lookup shows. */
export interface VerifiedSource {
  doi: string;
  title: string;
  venue: string | undefined;
  year: number | undefined;
  authors: string[];
}

export type SourceCheck =
  | ({ verified: true } & VerifiedSource)
  | { verified: false; doi?: string; reason: 'malformed' | 'not-found' | 'unreachable' };

const CROSSREF_WORKS = 'https://api.crossref.org/works/';
const TIMEOUT_MS = 8_000;

interface CrossrefMessage {
  title?: unknown;
  'container-title'?: unknown;
  issued?: { 'date-parts'?: unknown };
  author?: unknown;
}

const firstString = (value: unknown): string | undefined =>
  Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;

/** Look a DOI up in Crossref. Never throws. */
export async function checkDoi(
  input: string,
  fetchImpl: SourceFetch = fetch as unknown as SourceFetch,
): Promise<SourceCheck> {
  const doi = normalizeDoi(input);
  if (doi === undefined) {
    return { verified: false, reason: 'malformed' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${CROSSREF_WORKS}${encodeURIComponent(doi)}`, {
      headers: { accept: 'application/json', 'user-agent': 'falsify (source verification)' },
      signal: controller.signal,
    });
    if (res.status === 404) {
      return { verified: false, doi, reason: 'not-found' };
    }
    if (!res.ok) {
      return { verified: false, doi, reason: 'unreachable' };
    }
    const message = ((await res.json()) as { message?: CrossrefMessage }).message;
    const title = firstString(message?.title);
    if (message === undefined || title === undefined) {
      return { verified: false, doi, reason: 'not-found' };
    }
    const year = (message.issued?.['date-parts'] as unknown[][] | undefined)?.[0]?.[0];
    const authors = Array.isArray(message.author)
      ? message.author
          .map((a) => (a as { family?: unknown }).family)
          .filter((f): f is string => typeof f === 'string')
          .slice(0, 3)
      : [];
    return {
      verified: true,
      doi,
      title,
      venue: firstString(message['container-title']),
      year: typeof year === 'number' ? year : undefined,
      authors,
    };
  } catch {
    return { verified: false, doi, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
