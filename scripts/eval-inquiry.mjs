#!/usr/bin/env node
/**
 * Measure whether the falsify-inquiry guidance changes how an agent uses Falsify.
 *
 *   node scripts/eval-inquiry.mjs [--condition control|guided|both] [--only id,id]
 *                                 [--questions file] [--model name] [--out dir]
 *
 * For each question it starts a Copilot CLI agent in a scratch directory, with the
 * built Falsify server attached and its own data directory. In the "guided" condition
 * the scratch directory also holds the guidance files from this repo's `.github`.
 * Everything is scored from what the server recorded and from the tool calls in the
 * transcript, never from what the agent says about itself.
 *
 * It spends real model credits (about 10-20 per run) and needs: `npm run build`, the
 * `copilot` CLI, and network access. Results are written to --out (default: a temp dir).
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(repo, 'dist', 'src', 'mcp', 'server.js');
const GUIDANCE = ['.github/instructions/falsify-inquiry.instructions.md', '.github/skills/falsify-inquiry/SKILL.md'];

function parseArgs(argv) {
  const args = { condition: 'both', questions: join(repo, 'calibration', 'inquiry-questions.json') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key === undefined || argv[i + 1] === undefined) throw new Error(`Missing value for ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  return args;
}

function prepare(root, condition, tag) {
  const cwd = join(root, `${condition}-${tag}`);
  const data = join(cwd, '.data');
  mkdirSync(data, { recursive: true });
  if (condition === 'guided') {
    for (const rel of GUIDANCE) {
      const target = join(cwd, rel);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repo, rel), target);
    }
  }
  const config = join(cwd, '.mcp.json');
  writeFileSync(
    config,
    JSON.stringify({ mcpServers: { falsify: { type: 'stdio', command: 'node', args: [server], env: { FALSIFY_DATA_DIR: data }, tools: ['*'] } } }),
  );
  return { cwd, data, config };
}

function runAgent({ cwd, config }, question, model) {
  if (/["%`$]/.test(question)) throw new Error(`Question contains a character the runner cannot quote: ${question}`);
  const prompt = `Use the Falsify tools to investigate this question, and give me your conclusion: ${question}`;
  const flags = ['--additional-mcp-config', `"@${config}"`, '--allow-all-tools', '--allow-all-paths', '--disable-builtin-mcps', '--no-ask-user'];
  if (model !== undefined) flags.push('--model', model);
  const run = spawnSync(`copilot -p "${prompt}" ${flags.join(' ')}`, { cwd, shell: true, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

const words = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

function readSessions(data) {
  const dir = join(data, 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** Facts about one finished run, taken from the server's record and the transcript. */
export function scoreRun(data, transcript) {
  const sessions = readSessions(data);
  const tools = (name) => (transcript.match(new RegExp(`${name} \\(MCP: falsify\\)`, 'g')) ?? []).length;
  const webCalls = (transcript.match(/● (?:Fetching web content|web_search)/g) ?? []).length;
  const evidence = sessions.flatMap((s) => s.analysis?.evidence ?? []);
  const analysed = sessions.filter((s) => s.analysis !== undefined);
  return {
    sessions: sessions.length,
    reachedAnalysis: analysed.length,
    confirmed: sessions.filter((s) => s.state === 'theory').length,
    mirrorLinked: sessions.some((s) => s.mirrorOf !== undefined),
    mirrorCompleted: sessions.some((s) => s.mirrorOf !== undefined && analysed.some((a) => a.id === s.mirrorOf)),
    refusals: (transcript.match(/"rule":"[a-z]+:[a-z-]+"/g) ?? []).length,
    verifyCalls: tools('falsify_verify_source'),
    doiNotFound: (transcript.match(/"verified":false,"reason":"not-found"/g) ?? []).length,
    webCalls,
    evidenceItems: evidence.length,
    sourcesVerified: evidence.filter((e) => e.sourceVerified === true).length,
    pValuesSupplied: evidence.filter((e) => e.pValue !== undefined).length,
    replicationClaimed: evidence.filter((e) => e.replicationDoi !== undefined || e.replicated === true).length,
    replicationCredited: evidence.filter((e) => e.replicated === true).length,
    searchWords: Math.max(0, ...analysed.map((s) => words(s.analysis.evidenceSearch?.description))),
    contraryReported: Math.max(0, ...analysed.map((s) => s.analysis.evidenceSearch?.contraryFound ?? 0)),
    falsifiers: Math.max(0, ...sessions.map((s) => s.hypothesis?.falsificationConditions.length ?? 0)),
    verdicts: analysed.map((s) => s.analysis.verdict).join('/') || '-',
  };
}

function summarize(rows) {
  const cols = ['sessions', 'reachedAnalysis', 'mirrorCompleted', 'webCalls', 'verifyCalls', 'doiNotFound', 'sourcesVerified', 'replicationClaimed', 'replicationCredited', 'searchWords', 'contraryReported', 'falsifiers', 'refusals'];
  const lines = [`| condition | question | ${cols.join(' | ')} | verdicts |`, `|${'---|'.repeat(cols.length + 3)}`];
  for (const r of rows) lines.push(`| ${r.condition} | ${r.id} | ${cols.map((c) => String(r.score[c])).join(' | ')} | ${r.score.verdicts} |`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(server)) throw new Error('Run `npm run build` first: dist/src/mcp/server.js is missing.');
  const { questions } = JSON.parse(readFileSync(args.questions, 'utf8'));
  const only = args.only?.split(',');
  const picked = questions.filter((q) => only === undefined || only.includes(q.id));
  const conditions = args.condition === 'both' ? ['control', 'guided'] : [args.condition];
  const out = args.out ?? mkdtempSync(join(tmpdir(), 'falsify-eval-'));
  mkdirSync(out, { recursive: true });

  const rows = [];
  for (const q of picked) {
    for (const condition of conditions) {
      process.stderr.write(`running ${condition} / ${q.id} ...\n`);
      const env = prepare(out, condition, q.id);
      const transcript = runAgent(env, q.question, args.model);
      writeFileSync(join(env.cwd, 'transcript.txt'), transcript);
      rows.push({ condition, id: q.id, group: q.group, score: scoreRun(env.data, transcript) });
    }
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));
  console.log(summarize(rows));
  console.log(`\nResults and transcripts: ${out}`);
  console.log('Small samples from one model: read differences as a sketch, not a measurement.');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
