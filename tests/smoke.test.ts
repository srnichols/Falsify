import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('scaffold smoke test', () => {
  it('exports a semver-shaped VERSION', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
