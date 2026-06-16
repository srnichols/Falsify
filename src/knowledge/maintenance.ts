/**
 * Knowledge maintenance helpers.
 *
 * The YAML tier files remain canonical. These helpers make updates safer by
 * validating tier-specific entry shapes, linting the corpus for drift, and
 * mirroring to OpenBrain only after the source-of-truth write succeeds.
 */

import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { loadConfig } from '../config.js';
import {
  ContestedEntrySchema,
  FactEntrySchema,
  QuantEntrySchema,
  RefutedEntrySchema,
  TierSchema,
} from '../domain/schemas.js';
import type { KnowledgeEntry, Tier } from '../domain/types.js';
import { OpenBrainMcpClient } from '../memory/openbrainMcpClient.js';
import {
  DEFAULT_KNOWLEDGE_DIR,
  KnowledgeFileSchema,
  TIER_FILES,
  allEntries,
  loadAllKnowledge,
  type KnowledgeFile,
} from './loader.js';
import { buildSeedMemories, syncSeed, type SeedSyncSummary } from './seedSync.js';

const TEMP_PREFIX = 'falsify-knowledge-';

export type KnowledgeLintIssueCode =
  | 'duplicate-id'
  | 'duplicate-primary-text'
  | 'tier-id-prefix-mismatch';

export interface KnowledgeLintIssue {
  code: KnowledgeLintIssueCode;
  message: string;
  id?: string;
  tier?: Tier;
  otherTier?: Tier;
}

export interface KnowledgeLintSummary {
  issueCount: number;
  issues: KnowledgeLintIssue[];
}

export interface KnowledgeMutationResult {
  action: 'added' | 'updated' | 'moved';
  id: string;
  tier: Tier;
  previousTier?: Tier;
  filePath: string;
}

export type KnowledgeTemplate =
  | Record<string, unknown>
  | {
      id: string;
      statement?: string;
      question?: string;
      principle?: string;
      claim?: string;
    };

export interface KnowledgeSyncOverview {
  dryRun: boolean;
  total: number;
  byTier: Record<Tier, number>;
  saved?: number;
  queued?: number;
}

interface EntryLocation {
  entry: KnowledgeEntry;
  tier: Tier;
}

type FactTier = 'bedrock' | 'established';

function isFactTier(tier: Tier): tier is FactTier {
  return tier === 'bedrock' || tier === 'established';
}

function parseEntryForTier(tier: Tier, entry: unknown): KnowledgeEntry {
  if (isFactTier(tier)) {
    return FactEntrySchema.parse(entry);
  }
  if (tier === 'contested') {
    return ContestedEntrySchema.parse(entry);
  }
  if (tier === 'quantitative') {
    return QuantEntrySchema.parse(entry);
  }
  return RefutedEntrySchema.parse(entry);
}

function getKnowledgeFilePath(knowledgeDir: string, tier: Tier): string {
  return join(knowledgeDir, TIER_FILES[tier]);
}

function getPrimaryText(entry: KnowledgeEntry): string {
  if ('statement' in entry) {
    return entry.statement;
  }
  if ('question' in entry) {
    return entry.question;
  }
  if ('principle' in entry && typeof entry.principle === 'string') {
    return entry.principle;
  }
  return entry.claim;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function findEntryById(
  knowledge: Record<Tier, KnowledgeFile>,
  id: string,
): EntryLocation | undefined {
  for (const { tier, entry } of allEntries(knowledge)) {
    if (entry.id === id) {
      return { entry, tier };
    }
  }
  return undefined;
}

function parseTierDocument(filePath: string): { raw: string; doc: ReturnType<typeof parseDocument> } {
  const raw = readFileSync(filePath, 'utf8');
  return { raw, doc: parseDocument(raw) };
}

function getEntriesSeq(doc: ReturnType<typeof parseDocument>, filePath: string): YAMLSeq<unknown> {
  const root = doc.contents;
  if (!(root instanceof YAMLMap)) {
    throw new Error(`Knowledge file ${filePath} does not contain a YAML mapping at the root.`);
  }
  const entries = root.get('entries', true);
  if (!(entries instanceof YAMLSeq)) {
    throw new Error(`Knowledge file ${filePath} does not contain an entries sequence.`);
  }
  return entries;
}

function findEntryIndex(entries: YAMLSeq<unknown>, id: string): number {
  return entries.items.findIndex((item) => {
    if (!(item instanceof YAMLMap)) {
      return false;
    }
    const parsed = item.toJSON() as { id?: unknown };
    return parsed.id === id;
  });
}

function writeAtomicFiles(fileWrites: ReadonlyArray<{ path: string; content: string }>): void {
  const stagingDir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  const stagedPaths: string[] = [];

  try {
    for (const fileWrite of fileWrites) {
      const stagedPath = join(stagingDir, basename(fileWrite.path));
      writeFileSync(stagedPath, fileWrite.content, 'utf8');
      stagedPaths.push(stagedPath);
    }

    fileWrites.forEach((fileWrite, index) => {
      renameSync(stagedPaths[index]!, fileWrite.path);
    });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function validateSerializedKnowledgeFile(filePath: string, content: string): void {
  const parsed = parseYaml(content) as unknown;
  KnowledgeFileSchema.parse(parsed);
  const tier = TierSchema.parse((parsed as { tier?: unknown }).tier);
  const expectedTier = Object.entries(TIER_FILES).find(([, fileName]) => fileName === basename(filePath))?.[0];
  if (expectedTier !== undefined && tier !== expectedTier) {
    throw new Error(
      `Knowledge file ${basename(filePath)} declares tier '${tier}' but is stored at '${expectedTier}'.`,
    );
  }
}

function countEntriesByTier(knowledge: Record<Tier, KnowledgeFile>): Record<Tier, number> {
  return {
    bedrock: knowledge.bedrock.entries.length,
    established: knowledge.established.entries.length,
    contested: knowledge.contested.entries.length,
    quantitative: knowledge.quantitative.entries.length,
    refuted: knowledge.refuted.entries.length,
  };
}

export function readKnowledgeEntryFile(filePath: string): unknown {
  return parseYaml(readFileSync(filePath, 'utf8')) as unknown;
}

export function getKnowledgeTemplate(tier: Tier): KnowledgeTemplate {
  if (tier === 'bedrock' || tier === 'established') {
    return {
      id: `${tier}.discipline.topic_name`,
      statement: 'Replace with a falsifiable statement of the law, theory, or regularity.',
      domain: 'discipline/subdiscipline',
      type: 'law',
      falsifiable: true,
      falsified_if: 'Describe the observation that would prove this wrong.',
      status: 'unrefuted',
      confidence: 'high',
      domain_of_validity: 'State any bounded assumptions, approximations, or scale limits.',
      sources: ['Primary source or authoritative review'],
    };
  }

  if (tier === 'contested') {
    return {
      id: 'contested.discipline.question_name',
      question: 'Replace with the live scientific question.',
      domain: 'discipline/subdiscipline',
      note: 'Optional context about what remains unresolved.',
      positions: [
        {
          label: 'position-a',
          claim: 'Describe the first defensible position.',
          falsifiability_status: 'scientific',
          falsifiable: true,
          falsified_if: 'Describe what evidence would count against this position.',
          evidence_pointers: ['evidence stream 1'],
        },
        {
          label: 'position-b',
          claim: 'Describe the competing position.',
          falsifiability_status: 'conditional',
          falsifiable: 'depends',
          falsified_if: 'Explain what would decide against this position if framed scientifically.',
          evidence_pointers: ['evidence stream 2'],
        },
      ],
      engine_directive: 'present_all_positions_with_falsifiability; do_not_pick_winner',
    };
  }

  if (tier === 'quantitative') {
    return {
      id: 'quant.principle_name',
      principle: 'Replace with the quantitative principle name.',
      statement: 'Describe the lens and when it matters.',
      formula: 'Optional formula',
      triggers: ['situation where the lens should activate'],
      failure_guarded: 'Describe the reasoning failure this lens catches.',
    };
  }

  return {
    id: 'refuted.discipline.claim_name',
    claim: 'Replace with the falsified claim.',
    domain: 'discipline/subdiscipline',
    type: 'theory',
    era: 'Optional historical period',
    falsified_by: 'Describe the decisive observation or experiment.',
    superseded_by: 'Optional better-supported replacement.',
    lesson: 'State the methodological lesson worth preserving.',
    sources: ['Primary source or authoritative review'],
  };
}

export function lintKnowledge(knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR): KnowledgeLintSummary {
  const knowledge = loadAllKnowledge(knowledgeDir);
  const issues: KnowledgeLintIssue[] = [];
  const seenIds = new Map<string, Tier>();
  const seenPrimaryText = new Map<string, { id: string; tier: Tier }>();

  for (const { tier, entry } of allEntries(knowledge)) {
    const expectedPrefix = `${tier}.`;
    if (!entry.id.startsWith(expectedPrefix)) {
      issues.push({
        code: 'tier-id-prefix-mismatch',
        id: entry.id,
        tier,
        message: `Entry id '${entry.id}' should start with '${expectedPrefix}'.`,
      });
    }

    const previousTier = seenIds.get(entry.id);
    if (previousTier !== undefined) {
      issues.push({
        code: 'duplicate-id',
        id: entry.id,
        tier,
        otherTier: previousTier,
        message: `Entry id '${entry.id}' is duplicated in tiers '${previousTier}' and '${tier}'.`,
      });
    } else {
      seenIds.set(entry.id, tier);
    }

    const normalizedPrimaryText = normalizeText(getPrimaryText(entry));
    const previousText = seenPrimaryText.get(normalizedPrimaryText);
    if (previousText !== undefined && previousText.id !== entry.id) {
      issues.push({
        code: 'duplicate-primary-text',
        id: entry.id,
        tier,
        otherTier: previousText.tier,
        message:
          `Primary text for '${entry.id}' duplicates '${previousText.id}'. ` +
          'Review whether one of them should be merged or rephrased.',
      });
    } else {
      seenPrimaryText.set(normalizedPrimaryText, { id: entry.id, tier });
    }
  }

  return {
    issueCount: issues.length,
    issues,
  };
}

export function addKnowledgeEntry(
  tier: Tier,
  entry: unknown,
  knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR,
): KnowledgeMutationResult {
  const parsedEntry = parseEntryForTier(tier, entry);
  const knowledge = loadAllKnowledge(knowledgeDir);
  const duplicate = findEntryById(knowledge, parsedEntry.id);
  if (duplicate !== undefined) {
    throw new Error(
      `Entry id '${parsedEntry.id}' already exists in tier '${duplicate.tier}'. Use update or move instead.`,
    );
  }

  const filePath = getKnowledgeFilePath(knowledgeDir, tier);
  const { doc } = parseTierDocument(filePath);
  const entries = getEntriesSeq(doc, filePath);
  entries.add(parsedEntry);

  const nextContent = doc.toString();
  validateSerializedKnowledgeFile(filePath, nextContent);
  writeAtomicFiles([{ path: filePath, content: nextContent }]);

  return {
    action: 'added',
    id: parsedEntry.id,
    tier,
    filePath,
  };
}

export function updateKnowledgeEntry(
  tier: Tier,
  entry: unknown,
  knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR,
): KnowledgeMutationResult {
  const parsedEntry = parseEntryForTier(tier, entry);
  const knowledge = loadAllKnowledge(knowledgeDir);
  const existing = findEntryById(knowledge, parsedEntry.id);
  if (existing !== undefined && existing.tier !== tier) {
    throw new Error(
      `Entry id '${parsedEntry.id}' already exists in tier '${existing.tier}'. Move it before updating across tiers.`,
    );
  }

  const filePath = getKnowledgeFilePath(knowledgeDir, tier);
  const { doc } = parseTierDocument(filePath);
  const entries = getEntriesSeq(doc, filePath);
  const existingIndex = findEntryIndex(entries, parsedEntry.id);

  if (existingIndex >= 0) {
    entries.set(existingIndex, parsedEntry);
  } else {
    entries.add(parsedEntry);
  }

  const nextContent = doc.toString();
  validateSerializedKnowledgeFile(filePath, nextContent);
  writeAtomicFiles([{ path: filePath, content: nextContent }]);

  return {
    action: existingIndex >= 0 ? 'updated' : 'added',
    id: parsedEntry.id,
    tier,
    filePath,
  };
}

export function upsertKnowledgeEntry(
  tier: Tier,
  entry: unknown,
  knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR,
): KnowledgeMutationResult {
  return updateKnowledgeEntry(tier, entry, knowledgeDir);
}

export function moveKnowledgeEntry(
  id: string,
  targetTier: Tier,
  knowledgeDir: string = DEFAULT_KNOWLEDGE_DIR,
): KnowledgeMutationResult {
  const knowledge = loadAllKnowledge(knowledgeDir);
  const located = findEntryById(knowledge, id);
  if (located === undefined) {
    throw new Error(`Entry id '${id}' was not found in the knowledge corpus.`);
  }
  if (located.tier === targetTier) {
    throw new Error(`Entry id '${id}' is already in tier '${targetTier}'.`);
  }

  const parsedEntry = parseEntryForTier(targetTier, located.entry);
  const sourceFilePath = getKnowledgeFilePath(knowledgeDir, located.tier);
  const targetFilePath = getKnowledgeFilePath(knowledgeDir, targetTier);
  const { doc: sourceDoc } = parseTierDocument(sourceFilePath);
  const { doc: targetDoc } = parseTierDocument(targetFilePath);
  const sourceEntries = getEntriesSeq(sourceDoc, sourceFilePath);
  const targetEntries = getEntriesSeq(targetDoc, targetFilePath);
  const sourceIndex = findEntryIndex(sourceEntries, id);

  if (sourceEntries.items.length <= 1) {
    throw new Error(
      `Cannot move the last entry out of tier '${located.tier}'. Each tier file must retain at least one entry.`,
    );
  }

  if (sourceIndex < 0) {
    throw new Error(`Entry id '${id}' was not found in source file '${sourceFilePath}'.`);
  }

  sourceEntries.delete(sourceIndex);
  targetEntries.add(parsedEntry);

  const nextSourceContent = sourceDoc.toString();
  const nextTargetContent = targetDoc.toString();
  validateSerializedKnowledgeFile(sourceFilePath, nextSourceContent);
  validateSerializedKnowledgeFile(targetFilePath, nextTargetContent);
  writeAtomicFiles([
    { path: sourceFilePath, content: nextSourceContent },
    { path: targetFilePath, content: nextTargetContent },
  ]);

  return {
    action: 'moved',
    id,
    tier: targetTier,
    previousTier: located.tier,
    filePath: targetFilePath,
  };
}

export async function syncKnowledge(
  options: {
    knowledgeDir?: string;
    dryRun?: boolean;
  } = {},
): Promise<KnowledgeSyncOverview & { syncSummary?: SeedSyncSummary }> {
  const knowledgeDir = resolve(options.knowledgeDir ?? DEFAULT_KNOWLEDGE_DIR);
  const dryRun = options.dryRun ?? false;
  const knowledge = loadAllKnowledge(knowledgeDir);
  const byTier = countEntriesByTier(knowledge);

  if (dryRun) {
    const memories = buildSeedMemories(knowledge);
    return {
      dryRun: true,
      total: memories.length,
      byTier,
    };
  }

  const config = loadConfig();
  const client = new OpenBrainMcpClient(config, { throttleMs: 400 });
  try {
    const summary = await syncSeed(client, knowledge);
    return {
      dryRun: false,
      total: summary.total,
      byTier,
      saved: summary.saved,
      queued: summary.queued,
      syncSummary: summary,
    };
  } finally {
    await client.close();
  }
}