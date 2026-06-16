/**
 * Seed-sync CLI — mirrors `knowledge/*.yaml` into OpenBrain.
 *
 * Usage (after `npm run build`):
 *   node dist/src/cli/seedSync.js          # push the whole corpus
 *   node dist/src/cli/seedSync.js --dry-run # build + report, no network
 *
 * The YAML remains the source of truth; this only refreshes the searchable copy.
 * The OpenBrain key is read from the environment and is never printed.
 */

import { syncKnowledge } from '../knowledge/maintenance.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const overview = await syncKnowledge({ dryRun });

  if (overview.dryRun) {
    console.log(`[seed-sync] DRY RUN — ${overview.total} memories would be pushed:`);
    console.log(`  bedrock       ${overview.byTier.bedrock}`);
    console.log(`  established   ${overview.byTier.established}`);
    console.log(`  contested     ${overview.byTier.contested}`);
    console.log(`  quantitative  ${overview.byTier.quantitative}`);
    console.log(`  refuted       ${overview.byTier.refuted}`);
    return;
  }

  console.log(
    `[seed-sync] done: ${overview.saved}/${overview.total} saved, ${overview.queued} queued offline.`,
  );
  if ((overview.queued ?? 0) > 0) {
    console.log(
      '[seed-sync] some memories were queued locally (brain unreachable). ' +
        'They will drain on the next successful save.',
    );
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  // Never interpolate the config/key — print only the error's own message.
  console.error('[seed-sync] failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
