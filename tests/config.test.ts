import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../src/config.js';

describe('loadConfig', () => {
  it('builds a config from the environment', () => {
    const cfg = loadConfig({
      OPENBRAIN_REST_BASE: 'https://brain.example.test',
      OPENBRAIN_KEY: 'abc123',
      FALSIFY_BRAIN_PROJECT: 'falsify',
    } as NodeJS.ProcessEnv);
    expect(cfg.brainRestBase).toBe('https://brain.example.test');
    expect(cfg.brainKey).toBe('abc123');
    expect(cfg.project).toBe('falsify');
  });

  it('applies defaults for base and project', () => {
    const cfg = loadConfig({ OPENBRAIN_KEY: 'abc123' } as NodeJS.ProcessEnv);
    expect(cfg.brainRestBase).toBe('https://brain.planforge.software');
    expect(cfg.project).toBe('falsify');
  });

  it('throws a typed ConfigError when the key is absent', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it('never includes the key value in the error message', () => {
    const secret = 'do-not-leak-me';
    // Key present but base invalid → error should reference the field, not the secret.
    try {
      loadConfig({ OPENBRAIN_KEY: secret, OPENBRAIN_REST_BASE: 'not-a-url' } as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
