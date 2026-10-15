import { describe, it, expect } from 'vitest';
import { handleRequest } from '../../src/web/api.js';

const positions = [
  {
    label: 'model-a',
    statement: 'Caffeine improves reaction time',
    predicts: 'reaction time falls after a 200mg dose',
    falsificationConditions: [{ description: 'no drop in reaction time versus placebo' }],
  },
  {
    label: 'model-b',
    statement: 'Caffeine worsens reaction time through jitter',
    predicts: 'reaction time rises after a 200mg dose',
    falsificationConditions: [{ description: 'tremor amplitude unchanged on an accelerometer after dosing' }],
  },
];

describe('POST /api/dissent', () => {
  it('compares positions and never names a winner', async () => {
    const res = await handleRequest('POST', '/api/dissent', { positions });
    expect(res.status).toBe(200);
    expect(res.json.winner).toBeNull();
  });

  it('returns 400 for a single position and 422 when none pass the honesty rules', async () => {
    expect((await handleRequest('POST', '/api/dissent', { positions: [positions[0]] })).status).toBe(400);
    const bad = positions.map((p) => ({ ...p, falsificationConditions: [{ description: 'n/a' }] }));
    const res = await handleRequest('POST', '/api/dissent', { positions: bad });
    expect(res.status).toBe(422);
    expect(res.json.rule).toBe('dissent:two-valid-positions-required');
  });
});

describe('POST /api/related', () => {
  it('finds the tiers a claim touches', async () => {
    const res = await handleRequest('POST', '/api/related', { claim: 'Stomach ulcers are caused by stress and spicy food' });
    expect(res.status).toBe(200);
    expect((res.json.matches as { tier: string }[]).some((m) => m.tier === 'refuted')).toBe(true);
    expect(res.json.semantic).toBe('unavailable');
  });

  it('rejects a missing claim', async () => {
    expect((await handleRequest('POST', '/api/related', {})).status).toBe(400);
  });
});
