/**
 * Where Falsify's own files live, independent of the process working directory.
 *
 * An MCP host launches the server with the *user's* project as cwd, so the
 * corpus and the web assets must be found relative to the installed package, not
 * to wherever the host happened to start it.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The nearest ancestor of this module (compiled or source) that contains `marker`. */
export function findPackageAsset(marker: string, from: string = dirname(fileURLToPath(import.meta.url))): string | undefined {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, marker))) return join(dir, marker);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The knowledge directory: `FALSIFY_KNOWLEDGE_DIR` if set, else the package's own
 * `knowledge/`, else `./knowledge` (so a missing corpus fails with a clear path).
 */
export function resolveKnowledgeDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FALSIFY_KNOWLEDGE_DIR;
  if (configured !== undefined && configured !== '') return resolve(configured);
  return findPackageAsset(join('knowledge', 'bedrock.yaml'))?.replace(/[\\/]bedrock\.yaml$/, '') ?? resolve(process.cwd(), 'knowledge');
}

/** The directory the web UI's static assets are served from. */
export function resolvePublicDir(): string {
  return findPackageAsset(join('public', 'index.html'))?.replace(/[\\/]index\.html$/, '') ?? resolve(process.cwd(), 'public');
}
