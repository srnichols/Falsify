import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addKnowledgeEntry,
  getKnowledgeTemplate,
  lintKnowledge,
  moveKnowledgeEntry,
  upsertKnowledgeEntry,
  updateKnowledgeEntry,
} from '../../src/knowledge/maintenance.js';
import { loadAllKnowledge } from '../../src/knowledge/loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      try {
        import('node:fs').then(({ rmSync }) => rmSync(dir, { recursive: true, force: true }));
      } catch {
        // Best-effort cleanup in tests.
      }
    }
  }
});

function createKnowledgeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-knowledge-test-'));
  tempDirs.push(dir);

  writeFileSync(
    join(dir, 'bedrock.yaml'),
    `# bedrock comment preserved
tier: bedrock
weight: 1.0
entries:
  - id: bedrock.physics.alpha
    statement: Alpha is conserved.
    domain: physics/example
    type: law
    falsifiable: true
    falsified_if: Alpha is not conserved.
    status: unrefuted
    confidence: high
    sources: ["source-a"]
`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'established.yaml'),
    `tier: established
weight: 0.8
entries:
  - id: established.physics.beta
    statement: Beta is approximately linear.
    domain: physics/example
    type: law
    falsifiable: true
    falsified_if: Beta is not approximately linear.
    status: unrefuted
    confidence: medium
    sources: ["source-b"]
  - id: established.physics.theta
    statement: Theta remains stable within its calibrated envelope.
    domain: physics/example
    type: law
    falsifiable: true
    falsified_if: Theta leaves its calibrated envelope reproducibly.
    status: unrefuted
    confidence: medium
    sources: ["source-theta"]
`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'contested.yaml'),
    `tier: contested
weight: 0.5
entries:
  - id: contested.physics.gamma
    question: What explains gamma?
    domain: physics/example
    positions:
      - label: model-a
        claim: Model A explains gamma.
        falsifiability_status: scientific
      - label: model-b
        claim: Model B explains gamma.
        falsifiability_status: scientific
    engine_directive: present_all_positions_with_falsifiability; do_not_pick_winner
`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'quantitative.yaml'),
    `tier: quantitative
weight: cross-cutting
entries:
  - id: quant.delta
    principle: Delta principle
    statement: Delta should be checked.
    triggers: ["delta"]
    failure_guarded: ignoring delta
`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'refuted.yaml'),
    `tier: refuted
weight: 0
entries:
  - id: refuted.physics.epsilon
    claim: Epsilon is perpetual.
    domain: physics/example
    type: claim
    falsified_by: Epsilon failed under controlled test.
    lesson: Claims need decisive checks.
    sources: ["source-e"]
`,
    'utf8',
  );

  return dir;
}

describe('the shipped corpus', () => {
  it('has earned every Bedrock and Established entry its tier (no admission advisories)', () => {
    const summary = lintKnowledge();

    expect(summary.issues).toEqual([]);
    expect(summary.warnings.map((w) => w.message)).toEqual([]);
  });
});

describe('knowledge maintenance', () => {
  it('returns a valid tier-specific template for contested entries', () => {
    const template = getKnowledgeTemplate('contested');

    expect(template.id).toBe('contested.discipline.question_name');
    expect(Array.isArray((template as { positions?: unknown[] }).positions)).toBe(true);
    expect((template as { engine_directive?: string }).engine_directive).toContain('do_not_pick_winner');
  });

  it('adds a new entry to the chosen tier and preserves file comments', () => {
    const dir = createKnowledgeDir();

    const result = addKnowledgeEntry(
      'bedrock',
      {
        id: 'bedrock.physics.zeta',
        statement: 'Zeta is conserved.',
        domain: 'physics/example',
        type: 'law',
        falsifiable: true,
        falsified_if: 'Zeta is not conserved.',
        status: 'unrefuted',
        confidence: 'high',
        sources: ['source-z'],
      },
      dir,
    );

    expect(result.action).toBe('added');
    const knowledge = loadAllKnowledge(dir);
    expect(knowledge.bedrock.entries.some((entry) => entry.id === 'bedrock.physics.zeta')).toBe(true);

    const serialized = readFileSync(join(dir, 'bedrock.yaml'), 'utf8');
    expect(serialized).toContain('# bedrock comment preserved');
  });

  it('updates an existing entry in place', () => {
    const dir = createKnowledgeDir();

    const result = updateKnowledgeEntry(
      'established',
      {
        id: 'established.physics.beta',
        statement: 'Beta is linear in its calibrated regime.',
        domain: 'physics/example',
        type: 'law',
        falsifiable: true,
        falsified_if: 'Beta is not linear in its calibrated regime.',
        status: 'unrefuted',
        confidence: 'high',
        sources: ['source-b'],
      },
      dir,
    );

    expect(result.action).toBe('updated');
    const knowledge = loadAllKnowledge(dir);
    const updated = knowledge.established.entries.find((entry) => entry.id === 'established.physics.beta');
    expect(updated).toBeDefined();
    expect('statement' in updated! && updated.statement).toContain('calibrated regime');
  });

  it('upserts by adding when the id does not exist yet', () => {
    const dir = createKnowledgeDir();

    const result = upsertKnowledgeEntry(
      'quantitative',
      {
        id: 'quant.sigma',
        principle: 'Sigma guardrail',
        statement: 'Sigma should be checked before concluding too much from a small shift.',
        triggers: ['small shift'],
        failure_guarded: 'overclaiming from weak signal',
      },
      dir,
    );

    expect(result.action).toBe('added');
    const knowledge = loadAllKnowledge(dir);
    expect(knowledge.quantitative.entries.some((entry) => entry.id === 'quant.sigma')).toBe(true);
  });

  it('moves a compatible fact entry between fact tiers', () => {
    const dir = createKnowledgeDir();

    const result = moveKnowledgeEntry('established.physics.beta', 'bedrock', dir);

    expect(result.action).toBe('moved');
    expect(result.previousTier).toBe('established');
    const knowledge = loadAllKnowledge(dir);
    expect(knowledge.established.entries.some((entry) => entry.id === 'established.physics.beta')).toBe(false);
    expect(knowledge.bedrock.entries.some((entry) => entry.id === 'established.physics.beta')).toBe(true);
  });

  it('rejects moves that would empty the source tier file', () => {
    const dir = createKnowledgeDir();
    updateKnowledgeEntry(
      'established',
      {
        id: 'established.physics.theta',
        statement: 'Theta remains stable within its calibrated envelope.',
        domain: 'physics/example',
        type: 'law',
        falsifiable: true,
        falsified_if: 'Theta leaves its calibrated envelope reproducibly.',
        status: 'unrefuted',
        confidence: 'medium',
        sources: ['source-theta'],
      },
      dir,
    );

    const secondDir = createKnowledgeDir();
    writeFileSync(
      join(secondDir, 'established.yaml'),
      `tier: established
weight: 0.8
entries:
  - id: established.physics.only
    statement: Only entry remains in the source tier.
    domain: physics/example
    type: law
    falsifiable: true
    falsified_if: Only entry is disproved.
    status: unrefuted
    confidence: medium
    sources: ["source-only"]
`,
      'utf8',
    );

    expect(() => moveKnowledgeEntry('established.physics.only', 'bedrock', secondDir)).toThrow(
      /last entry out of tier 'established'/,
    );
  });

  it('advises, without failing, when a Bedrock or Established entry has not earned its tier', () => {
    const dir = createKnowledgeDir();

    const summary = lintKnowledge(dir);

    expect(summary.issueCount).toBe(0);
    const codes = summary.warnings.map((w) => w.code);
    expect(codes).toContain('thin-sourcing');
    expect(codes).toContain('missing-validity-domain');
    expect(summary.warnings.every((w) => w.tier === 'bedrock' || w.tier === 'established')).toBe(true);
    expect(summary.warningCount).toBe(summary.warnings.length);
  });

  it('advises when one field makes up too much of the corpus', () => {
    const dir = createKnowledgeDir();
    const entry = (id: string, domain: string): string =>
      `  - id: refuted.${id}\n    claim: Claim number ${id} was refuted.\n    domain: ${domain}\n    type: claim\n    falsified_by: Controlled test ${id} failed.\n    lesson: Claims need decisive checks.\n    sources: ["source-${id}"]\n`;
    const physics = Array.from({ length: 30 }, (_, i) => entry(`p${i}`, 'physics/example')).join('');
    const biology = Array.from({ length: 6 }, (_, i) => entry(`b${i}`, 'biology/example')).join('');
    writeFileSync(join(dir, 'refuted.yaml'), `tier: refuted\nweight: 0\nentries:\n${physics}${biology}`, 'utf8');

    const imbalance = lintKnowledge(dir).warnings.filter((w) => w.code === 'domain-imbalance');

    expect(imbalance).toHaveLength(1);
    expect(imbalance[0]?.message).toMatch(/'physics'/);
  });

  it('keeps the shipped corpus spread across fields, with real coverage of the human sciences', () => {
    const counts = new Map<string, number>();
    for (const [tier, file] of Object.entries(loadAllKnowledge())) {
      if (tier === 'quantitative') continue;
      for (const entry of file.entries) {
        const field = ('domain' in entry ? String(entry.domain) : '?').split('/')[0] ?? '?';
        counts.set(field, (counts.get(field) ?? 0) + 1);
      }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(Math.max(...counts.values()) / total).toBeLessThanOrEqual(0.32);
    expect(counts.get('social-science') ?? 0).toBeGreaterThanOrEqual(18);
    expect(counts.get('medicine') ?? 0).toBeGreaterThanOrEqual(16);
    expect(counts.get('economics') ?? 0).toBeGreaterThanOrEqual(6);
    expect(counts.get('neuroscience') ?? 0).toBeGreaterThanOrEqual(4);
    expect(counts.get('climate') ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('holds every contested position to the same standard: a falsifier, or an honest statement that none exists', () => {
    const missing: string[] = [];
    for (const entry of loadAllKnowledge().contested.entries) {
      if (!('positions' in entry)) continue;
      expect(entry.positions.length, `${entry.id} needs at least two positions`).toBeGreaterThanOrEqual(2);
      for (const position of entry.positions) {
        const saysNoTestExists = /outside-method|equivalent/.test(position.falsifiability_status);
        if (position.falsified_if === undefined && !saysNoTestExists) missing.push(`${entry.id}: ${position.label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('reports duplicate ids and tier/id prefix mismatches', () => {
    const dir = createKnowledgeDir();
    writeFileSync(
      join(dir, 'refuted.yaml'),
      `tier: refuted
weight: 0
entries:
  - id: bedrock.physics.alpha
    claim: Epsilon is perpetual.
    domain: physics/example
    type: claim
    falsified_by: Epsilon failed under controlled test.
    lesson: Claims need decisive checks.
    sources: ["source-e"]
`,
      'utf8',
    );

    const summary = lintKnowledge(dir);
    expect(summary.issueCount).toBeGreaterThanOrEqual(2);
    expect(summary.issues.some((issue) => issue.code === 'duplicate-id')).toBe(true);
    expect(summary.issues.some((issue) => issue.code === 'tier-id-prefix-mismatch')).toBe(true);
  });
});