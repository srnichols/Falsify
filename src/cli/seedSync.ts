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

import { loadConfig } from '../config.js';
import { loadAllKnowledge } from '../knowledge/loader.js';
import { buildSeedMemories, syncSeed } from '../knowledge/seedSync.js';
import { OpenBrainClient } from '../memory/openbrainClient.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const knowledge = loadAllKnowledge();

  if (dryRun) {
    const memories = buildSeedMemories(knowledge);
    console.log(`[seed-sync] DRY RUN — ${memories.length} memories would be pushed:`);
    const byTier = new Map<string, number>();
    for (const m of memories) {
      const tier = (m.metadata as { tier: string }).tier;
      byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
    }
    for (const [tier, n] of byTier) console.log(`  ${tier.padEnd(13)} ${n}`);
    return;
  }

  const config = loadConfig();
  const client = new OpenBrainClient(config);
  console.log(`[seed-sync] pushing corpus to project "${config.project}" …`);

  const summary = await syncSeed(client, knowledge);
  console.log(
    `[seed-sync] done: ${summary.saved}/${summary.total} saved, ${summary.queued} queued offline.`,
  );
  if (summary.queued > 0) {
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
