import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';

const root = resolve(process.cwd());
const doc = readFileSync(join(root, 'docs', 'CAPABILITIES.md'), 'utf8');
const flat = doc.replace(/\s+/g, ' ');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const sources = sourceFiles(join(root, 'src'));
const allSource = sources.map((f) => readFileSync(f, 'utf8')).join('\n');

const unique = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const matchAll = (text: string, pattern: RegExp): string[] => unique([...text.matchAll(pattern)].map((m) => m[1] ?? m[0]));

describe('docs/CAPABILITIES.md stays in step with the code', () => {
  it('names every MCP tool the server registers', () => {
    const tools = matchAll(allSource, /registerTool\(\s*'(falsify_[a-z_]+)'/g);
    expect(tools.length).toBeGreaterThanOrEqual(10);
    for (const tool of tools) expect(doc, `tool ${tool}`).toContain(`\`${tool}\``);
  });

  it('names every setting (environment variable) the code reads', () => {
    const vars = matchAll(allSource, /\b((?:FALSIFY|OPENBRAIN)_[A-Z_]+)\b/g);
    expect(vars.length).toBeGreaterThanOrEqual(14);
    for (const name of vars) expect(doc, `env var ${name}`).toContain(`\`${name}\``);
  });

  it('explains every refusal rule the code can emit', () => {
    const rules = matchAll(allSource, /'((?:honesty|analysis|review|cycle|session|mirror|outcome|dissent|recall|related|request):[a-z-]+)'/g);
    expect(rules.length).toBeGreaterThanOrEqual(40);
    for (const rule of rules) expect(doc, `rule ${rule}`).toContain(rule);
  });

  it('lists every web route', () => {
    const routes = matchAll(readFileSync(join(root, 'src', 'web', 'api.ts'), 'utf8'), /case '(?:GET|POST) (\/api\/[a-z/-]+)'/g);
    expect(routes.length).toBeGreaterThanOrEqual(13);
    for (const route of routes) expect(doc, `route ${route}`).toContain(route);
  });

  it('lists every npm script a user would run', () => {
    const scripts = Object.keys((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts);
    for (const script of scripts.filter((s) => s !== 'dev')) {
      const command = script === 'test' ? 'npm test' : `npm run ${script}`;
      expect(doc, `npm script ${script}`).toContain(command);
    }
  });

  it('keeps .env.example listing every setting the code reads', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    for (const name of matchAll(allSource, /\b((?:FALSIFY|OPENBRAIN)_[A-Z_]+)\b/g)) {
      expect(example, `.env.example should mention ${name}`).toContain(name);
    }
  });

  it('points at guidance files that exist', () => {
    for (const rel of [
      '.github/instructions/falsify-inquiry.instructions.md',
      '.github/skills/falsify-inquiry/SKILL.md',
      '.github/agents/falsify-reviewer.agent.md',
      '.github/prompts/falsify-inquiry.prompt.md',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
      expect(flat).toContain(rel.split('/').slice(-2).join('/').replace('.github/', ''));
    }
  });

  it('states the real corpus size by tier', () => {
    const knowledge = loadAllKnowledge();
    const counts = Object.fromEntries(Object.entries(knowledge).map(([tier, file]) => [tier, file.entries.length]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(flat).toContain(`${total} entries: ${counts.bedrock} Bedrock, ${counts.established} Established, ${counts.contested} Contested, ${counts.quantitative} Quantitative, ${counts.refuted} Refuted`);
  });
});
