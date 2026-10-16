import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = ['README.md', 'AGENTS.md', 'docs/CAPABILITIES.md', 'docs/USER-GUIDE.md'];

describe('documentation links and images', () => {
  for (const doc of DOCS) {
    it(`${doc}: every relative link and image points at a file that exists`, () => {
      const source = readFileSync(join(root, doc), 'utf8');
      const targets = [...source.matchAll(/!?\[[^\]]*\]\((\.{1,2}\/[^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1] as string);
      for (const target of targets) {
        expect(existsSync(resolve(root, dirname(doc), target)), `${doc} links to ${target}`).toBe(true);
      }
    });
  }

  it('the user guide shows every screenshot the capture script writes', () => {
    const guide = readFileSync(join(root, 'docs', 'USER-GUIDE.md'), 'utf8');
    const script = readFileSync(join(root, 'scripts', 'capture-screenshots.mjs'), 'utf8');
    for (const [, name] of script.matchAll(/shot\('([a-z-]+)'/g)) {
      expect(guide, `screenshot ${name}`).toContain(`./images/${name}.png`);
      const file = join(root, 'docs', 'images', `${name}.png`);
      expect(existsSync(file) && statSync(file).size > 10_000, `docs/images/${name}.png`).toBe(true);
    }
  });
});
