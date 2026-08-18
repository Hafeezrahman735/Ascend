import { describe, it, expect } from 'vitest';
import {
  orderAchievements, selectRowAchievements, allUnlocked, stabilizeOrder,
} from './achievementOrder';
import type { Achievement } from '../types';

const make = ({ key, ...over }: Partial<Achievement> & { key: string }): Achievement => ({
  id: key,
  key,
  title: key,
  description: '',
  icon: '*',
  xpReward: 100,
  category: 'SESSIONS',
  threshold: 10,
  isUnlocked: false,
  unlockedAt: null,
  isShared: false,
  currentValue: 0,
  progress: 0,
  ...over,
});

describe('orderAchievements', () => {
  it('puts earned achievements before unearned ones', () => {
    const out = orderAchievements([
      make({ key: 'locked' }),
      make({ key: 'earned', isUnlocked: true }),
    ]);
    expect(out.map((a) => a.key)).toEqual(['earned', 'locked']);
  });

  it('shows the hardest earned achievement first', () => {
    const out = orderAchievements([
      make({ key: 'easy', isUnlocked: true, tier: 1 }),
      make({ key: 'hardest', isUnlocked: true, tier: 4 }),
      make({ key: 'mid', isUnlocked: true, tier: 2 }),
    ]);
    expect(out.map((a) => a.key)).toEqual(['hardest', 'mid', 'easy']);
  });

  it('orders unearned by closest to unlocking, so the next goal is visible', () => {
    const out = orderAchievements([
      make({ key: 'far', progress: 0.1 }),
      make({ key: 'close', progress: 0.9 }),
      make({ key: 'middling', progress: 0.5 }),
    ]);
    expect(out.map((a) => a.key)).toEqual(['close', 'middling', 'far']);
  });

  it('does not let a high tier jump an unearned achievement above an earned one', () => {
    // Tier only ranks within the earned group. A locked tier-4 must never
    // outrank an unlocked tier-1, or the row leads with something you do not have.
    const out = orderAchievements([
      make({ key: 'locked-hard', tier: 4, progress: 0.99 }),
      make({ key: 'earned-easy', tier: 1, isUnlocked: true }),
    ]);
    expect(out[0].key).toBe('earned-easy');
  });

  it('is deterministic for identical achievements', () => {
    // Without a stable final tie-break the row can reshuffle between renders for
    // no visible reason.
    const input = [
      make({ key: 'b', threshold: 5 }),
      make({ key: 'a', threshold: 5 }),
      make({ key: 'c', threshold: 5 }),
    ];
    expect(orderAchievements(input).map((a) => a.key)).toEqual(['a', 'b', 'c']);
    expect(orderAchievements([...input].reverse()).map((a) => a.key)).toEqual(['a', 'b', 'c']);
  });

  it('treats an earned achievement as fully progressed even if the counter fell', () => {
    // A streak resets but the achievement is never revoked.
    const [only] = orderAchievements([make({ key: 'streak', isUnlocked: true, progress: 0 })]);
    expect(only.progress).toBe(1);
  });

  it('marks only tier 4 as gold, and never guesses when the server omits tier', () => {
    const [gold] = orderAchievements([make({ key: 'g', tier: 4 })]);
    expect(gold.isGold).toBe(true);

    const [notGold] = orderAchievements([make({ key: 'n', tier: 3 })]);
    expect(notGold.isGold).toBe(false);

    // Older server, no tier field: degrade to lowest tier rather than deriving a
    // duplicate threshold on the client.
    const [untiered] = orderAchievements([make({ key: 'u', xpReward: 2500 })]);
    expect(untiered.tier).toBe(1);
    expect(untiered.isGold).toBe(false);
  });
});

describe('selectRowAchievements', () => {
  const ordered = orderAchievements(
    Array.from({ length: 10 }, (_, i) => make({ key: `a${i}`, threshold: i })),
  );

  it('caps the row and reports the overflow for a "+N more" affordance', () => {
    const { visible, remaining } = selectRowAchievements(ordered, 4);
    expect(visible).toHaveLength(4);
    expect(remaining).toBe(6);
  });

  it('reports no overflow when everything fits', () => {
    expect(selectRowAchievements(ordered, 10).remaining).toBe(0);
    expect(selectRowAchievements(ordered, 99).remaining).toBe(0);
  });

  it('handles an empty catalogue and a zero limit without going negative', () => {
    expect(selectRowAchievements([], 4)).toEqual({ visible: [], remaining: 0 });
    expect(selectRowAchievements(ordered, 0)).toEqual({ visible: [], remaining: 10 });
  });
});

describe('allUnlocked', () => {
  it('is false for an empty catalogue', () => {
    // An empty list must not read as "you finished everything".
    expect(allUnlocked([])).toBe(false);
  });

  it('is true only when every achievement is earned', () => {
    expect(allUnlocked(orderAchievements([make({ key: 'a', isUnlocked: true })]))).toBe(true);
    expect(
      allUnlocked(orderAchievements([make({ key: 'a', isUnlocked: true }), make({ key: 'b' })])),
    ).toBe(false);
  });
});

describe('stabilizeOrder', () => {
  const ordered = orderAchievements([
    make({ key: 'a', progress: 0.9 }),
    make({ key: 'b', progress: 0.5 }),
    make({ key: 'c', progress: 0.1 }),
  ]);

  it('keeps the on-screen order when only progress changed', () => {
    // A refetch that nudges progress must not reshuffle tiles under the user.
    const refetched = orderAchievements([
      make({ key: 'a', progress: 0.1 }),
      make({ key: 'b', progress: 0.95 }),
      make({ key: 'c', progress: 0.2 }),
    ]);
    expect(refetched.map((a) => a.key)).toEqual(['b', 'c', 'a']);

    const stable = stabilizeOrder(ordered.map((a) => a.key), refetched);
    expect(stable.map((a) => a.key)).toEqual(['a', 'b', 'c']);
    // Values still update even though position does not.
    expect(stable[1].progress).toBeCloseTo(0.95);
  });

  it('reorders when something new is earned', () => {
    const grown = orderAchievements([
      make({ key: 'a' }), make({ key: 'b' }), make({ key: 'c' }), make({ key: 'd' }),
    ]);
    expect(stabilizeOrder(ordered.map((a) => a.key), grown)).toBe(grown);
  });

  it('falls back to the fresh order if a key disappeared', () => {
    const swapped = orderAchievements([
      make({ key: 'a' }), make({ key: 'b' }), make({ key: 'z' }),
    ]);
    expect(stabilizeOrder(ordered.map((a) => a.key), swapped)).toBe(swapped);
  });

  it('is a no-op on first render, when there is no previous order', () => {
    expect(stabilizeOrder([], ordered)).toBe(ordered);
  });
});
