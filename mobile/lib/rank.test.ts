import { describe, it, expect } from 'vitest';
import { getRank, getXpToNextRank, getXpProgressInRank, RANK_ORDER, RANK_THRESHOLDS } from './rank';

/**
 * These thresholds are duplicated in getRankTitle() in
 * backend/src/modules/social/routes.ts, which stamps a rank onto every post and
 * leaderboard row. If the two drift, a user sees one rank on their profile and a
 * different one on their own post — with nothing failing to compile.
 *
 * This suite pins the client side. Update it and the backend together.
 */
describe('rank thresholds (must match backend getRankTitle)', () => {
  it.each([
    [0, 'Rookie'],
    [999, 'Rookie'],
    [1000, 'Steady'],
    [2499, 'Steady'],
    [2500, 'Elite'],
    [4999, 'Elite'],
    [5000, 'Legend'],
    [9999, 'Legend'],
    [10000, 'Champion'],
    [999999, 'Champion'],
  ])('%i XP -> %s', (xp, expected) => {
    expect(getRank(xp)).toBe(expected);
  });

  it('has no school-specific tier names — the audience is not only students', () => {
    expect(RANK_ORDER).not.toContain('Scholar');
  });

  it('is ordered by ascending threshold', () => {
    const values = RANK_ORDER.map((t) => RANK_THRESHOLDS[t]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('getXpToNextRank', () => {
  it('counts down to the next tier', () => {
    expect(getXpToNextRank(0)).toBe(1000);
    expect(getXpToNextRank(900)).toBe(100);
    expect(getXpToNextRank(2500)).toBe(2500); // Elite -> Legend
  });

  it('is 0 at the top tier — there is nothing left to chase', () => {
    expect(getXpToNextRank(10000)).toBe(0);
    expect(getXpToNextRank(50000)).toBe(0);
  });
});

describe('getXpProgressInRank', () => {
  it('is 0 at the start of a tier and approaches 1 at its end', () => {
    expect(getXpProgressInRank(1000)).toBe(0);
    expect(getXpProgressInRank(1750)).toBeCloseTo(0.5);
  });

  it('is always within 0..1', () => {
    for (const xp of [0, 500, 1000, 3000, 7500, 10000, 999999]) {
      const p = getXpProgressInRank(xp);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('is full at the top tier', () => {
    expect(getXpProgressInRank(10000)).toBe(1);
  });
});
