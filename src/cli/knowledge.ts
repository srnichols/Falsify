/**
 * Knowledge maintenance CLI.
 *
 * Supports linting, adding, updating, moving, and syncing knowledge entries
 * while preserving the repo's truth-in-git / mirror-in-OpenBrain contract.
 */

import { resolve } from 'node:path';
import {
  addKnowledgeEntry,
  getKnowledgeTemplate,
  lintKnowledge,
  moveKnowledgeEntry,
  readKnowledgeEntryFile,
  syncKnowledge,
  upsertKnowledgeEntry,
  updateKnowledgeEntry,
} from '../knowledge/maintenance.js';
import { TierSchema } from '../domain/schemas.js';
import type { Tier } from '../domain/types.js';

interface ParsedArgs {
  command?: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument '${token}'. Flags must start with '--'.`);
    }
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token, true);
      continue;
    }
    flags.set(token, next);
    index += 1;
  }

  return command === undefined ? { flags } : { command, flags };
}

function getFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function hasFlag(flags: Map<string, string | true>, name: string): boolean {
  return flags.has(name);
}

function requireFlag(flags: Map<string, string | true>, name: string): string {
  const value = getFlag(flags, name);
  if (value === undefined) {
    throw new Error(`Missing required flag '${name}'.`);
  }
  return value;
}

function parseTierFlag(value: string): Tier {
  return TierSchema.parse(value);
}

function resolveKnowledgeDir(flags: Map<string, string | true>): string | undefined {
  const raw = getFlag(flags, '--knowledge-dir');
  return raw === undefined ? undefined : resolve(raw);
}

function printUsage(): void {
  console.log(`Usage:
  node dist/src/cli/knowledge.js template --tier TIER
  node dist/src/cli/knowledge.js lint [--knowledge-dir DIR]
  node dist/src/cli/knowledge.js sync [--dry-run] [--knowledge-dir DIR]
  node dist/src/cli/knowledge.js add --tier TIER --entry-file FILE [--sync] [--knowledge-dir DIR]
  node dist/src/cli/knowledge.js upsert --tier TIER --entry-file FILE [--sync] [--knowledge-dir DIR]
  node dist/src/cli/knowledge.js update --tier TIER --entry-file FILE [--sync] [--knowledge-dir DIR]
  node dist/src/cli/knowledge.js move --id ENTRY_ID --to TIER [--sync] [--knowledge-dir DIR]

Notes:
  --entry-file accepts YAML or JSON.
  YAML stays canonical; --sync mirrors the updated corpus to OpenBrain after the write succeeds.`);
}

async function maybeSync(flags: Map<string, string | true>): Promise<void> {
  if (!hasFlag(flags, '--sync')) {
    return;
  }

  const knowledgeDir = resolveKnowledgeDir(flags);
  const overview = await syncKnowledge(
    knowledgeDir === undefined ? {} : { knowledgeDir },
  );
  console.log(
    `[knowledge] sync complete: ${overview.saved}/${overview.total} saved, ${overview.queued} queued offline.`,
  );
  if ((overview.queued ?? 0) > 0) {
    process.exitCode = 1;
  }
}

async function run(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.command;
  const knowledgeDir = resolveKnowledgeDir(parsed.flags);

  if (command === undefined || command === '--help' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'lint') {
    const summary = lintKnowledge(knowledgeDir);
    if (summary.issueCount === 0) {
      console.log('[knowledge] lint clean: no duplicate ids, duplicate primary texts, or tier/id prefix mismatches.');
      return;
    }

    console.log(`[knowledge] lint found ${summary.issueCount} issue(s):`);
    for (const issue of summary.issues) {
      console.log(`- ${issue.code}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (command === 'template') {
    const tier = parseTierFlag(requireFlag(parsed.flags, '--tier'));
    console.log(JSON.stringify(getKnowledgeTemplate(tier), null, 2));
    return;
  }

  if (command === 'sync') {
    const overview = await syncKnowledge(
      knowledgeDir === undefined
        ? { dryRun: hasFlag(parsed.flags, '--dry-run') }
        : { knowledgeDir, dryRun: hasFlag(parsed.flags, '--dry-run') },
    );
    if (overview.dryRun) {
      console.log(`[knowledge] DRY RUN — ${overview.total} memories would be pushed:`);
      console.log(`  bedrock       ${overview.byTier.bedrock}`);
      console.log(`  established   ${overview.byTier.established}`);
      console.log(`  contested     ${overview.byTier.contested}`);
      console.log(`  quantitative  ${overview.byTier.quantitative}`);
      console.log(`  refuted       ${overview.byTier.refuted}`);
      return;
    }

    console.log(
      `[knowledge] sync complete: ${overview.saved}/${overview.total} saved, ${overview.queued} queued offline.`,
    );
    if ((overview.queued ?? 0) > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'add' || command === 'update' || command === 'upsert') {
    const tier = parseTierFlag(requireFlag(parsed.flags, '--tier'));
    const entryFile = resolve(requireFlag(parsed.flags, '--entry-file'));
    const entry = readKnowledgeEntryFile(entryFile);
    const result =
      command === 'add'
        ? addKnowledgeEntry(tier, entry, knowledgeDir)
        : command === 'update'
          ? updateKnowledgeEntry(tier, entry, knowledgeDir)
          : upsertKnowledgeEntry(tier, entry, knowledgeDir);

    console.log(
      `[knowledge] ${result.action}: ${result.id} in tier '${result.tier}' (${result.filePath}).`,
    );
    await maybeSync(parsed.flags);
    return;
  }

  if (command === 'move') {
    const id = requireFlag(parsed.flags, '--id');
    const targetTier = parseTierFlag(requireFlag(parsed.flags, '--to'));
    const result = moveKnowledgeEntry(id, targetTier, knowledgeDir);
    console.log(
      `[knowledge] moved: ${result.id} from '${result.previousTier}' to '${result.tier}' (${result.filePath}).`,
    );
    await maybeSync(parsed.flags);
    return;
  }

  throw new Error(`Unknown command '${command}'. Run with 'help' for usage.`);
}

run().catch((error: unknown) => {
  console.error('[knowledge] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});