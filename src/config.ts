/**
 * Falsify runtime configuration (DESIGN.md §5).
 *
 * The OpenBrain key is read from the environment at runtime — it is NEVER hard
 * coded or committed. An absent or malformed config raises a typed
 * {@link ConfigError} rather than crashing, and the error message never contains
 * the secret value.
 */

import { z } from 'zod';

/** Thrown when the environment does not provide a usable Falsify config. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const ConfigSchema = z.object({
  /** Public OpenBrain REST base, e.g. https://brain.planforge.software */
  brainRestBase: z.string().url(),
  /** The x-brain-key value. Secret — read from env, never logged. */
  brainKey: z.string().min(1),
  /** Project scope for every memory Falsify reads/writes. */
  project: z.string().min(1),
});

export type FalsifyConfig = z.infer<typeof ConfigSchema>;

/** Default OpenBrain REST endpoint (portable, public). */
export const DEFAULT_REST_BASE = 'https://brain.planforge.software';
/** Default project scope. */
export const DEFAULT_PROJECT = 'falsify';

/**
 * Build a validated config from environment variables.
 *
 * @throws {ConfigError} if required values are missing/invalid. The message
 *   reports only which fields failed — never the secret's value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): FalsifyConfig {
  const candidate = {
    brainRestBase: env.OPENBRAIN_REST_BASE ?? DEFAULT_REST_BASE,
    brainKey: env.OPENBRAIN_KEY ?? '',
    project: env.FALSIFY_BRAIN_PROJECT ?? DEFAULT_PROJECT,
  };

  const result = ConfigSchema.safeParse(candidate);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(root)'))].join(', ');
    throw new ConfigError(
      `Invalid Falsify config (${fields}). Set OPENBRAIN_KEY (and optionally OPENBRAIN_REST_BASE). ` +
        `The key is read from the environment and never stored in the repo.`,
    );
  }
  return result.data;
}
