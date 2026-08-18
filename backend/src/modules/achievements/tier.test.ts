import { describe, it, expect } from 'vitest';
import { deriveTier } from './tier';

/**
 * The boundaries are the whole test. An off-by-one at 50/150/600 silently
 * re-tiers the entire catalogue, and because tier drives the order of the
 * profile achievements row, the failure is visible to users but invisible in
 * logs.
 */
describe('deriveTier', () => {
  it('bands the real seeded xpReward values', () => {
    // Values taken from backend/prisma/seed.ts, one per band.
    expect(deriveTier(25)).toBe(1);    // first session
    expect(deriveTier(100)).toBe(2);   // early-bird
    expect(deriveTier(400)).toBe(3);   // 100 tasks
    expect(deriveTier(2500)).toBe(4);  // 500 sessions
  });

  it('starts tier 4 at the gold boundary the client already used', () => {
    // GOLD_TIER_XP is 500 in mobile/app/(tabs)/goals.tsx. Tier 4 must begin at
    // exactly 500 so swapping the client check for this tier changes no pixels.
    expect(deriveTier(499)).toBe(3);
    expect(deriveTier(500)).toBe(4);
    expect(deriveTier(600)).toBe(4);
  });

  it('places each boundary value in the higher tier', () => {
    expect(deriveTier(50)).toBe(1);
    expect(deriveTier(51)).toBe(2);
    expect(deriveTier(150)).toBe(2);
    expect(deriveTier(151)).toBe(3);
  });

  it('never returns undefined for unusable input', () => {
    // A future seed omitting xpReward must not sort unpredictably against
    // everything else.
    expect(deriveTier(0)).toBe(1);
    expect(deriveTier(-1)).toBe(1);
    expect(deriveTier(NaN)).toBe(1);
    expect(deriveTier(undefined as unknown as number)).toBe(1);
  });

  it('is monotonic — more xp never means a lower tier', () => {
    let previous = 0;
    for (let xp = 0; xp <= 3000; xp += 5) {
      const tier = deriveTier(xp);
      expect(tier).toBeGreaterThanOrEqual(previous);
      previous = tier;
    }
  });
});
