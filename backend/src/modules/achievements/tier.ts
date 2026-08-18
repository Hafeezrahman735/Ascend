/**
 * Achievement difficulty tier, 1 (easiest) to 4 (hardest).
 *
 * Banded on `xpReward`, NOT on `threshold`. Thresholds are not comparable across
 * categories — a STREAK threshold of 30 is punishing while a SESSIONS threshold
 * of 50 is routine, and six SESSIONS achievements share a placeholder threshold
 * of 1. xpReward is the only authored value that ranks difficulty consistently
 * across every category (25 -> 2500), which is why the client's existing
 * gold-tier check already banded on it.
 *
 * Lives in its own module rather than in routes.ts so it can be unit-tested
 * without pulling in Prisma, Express and the env-validating config module.
 *
 * PROVISIONAL: this is derived because Achievement has no `tier` column yet.
 * When an authored tier lands, delete this and read the column. Until then the
 * tier is used for ORDERING ONLY and is never rendered as a visible label — a
 * re-tiering later would otherwise look like a downgrade, and achievements in
 * this system are never revoked.
 */
export type AchievementTier = 1 | 2 | 3 | 4;

/**
 * Minimum xpReward for each tier.
 *
 * Tier 4 starts at 500 on purpose: that is the exact boundary the mobile client
 * has always used for its "gold" accent (`GOLD_TIER_XP` in goals.tsx). Aligning
 * them means tier 4 IS gold, so replacing the client-side check with this
 * server-derived tier changes no pixels — a pure de-duplication rather than a
 * visible re-tiering. Against the seeded values (25, 50, 75, 100, 150, 200, 250,
 * 300, 400, 500, 600, 1000, 2000, 2500) this yields 2/3/4/5 achievements per
 * tier, which is a usable spread.
 */
export const TIER_MINIMUMS = { 2: 51, 3: 151, 4: 500 } as const;

export function deriveTier(xpReward: number): AchievementTier {
  // Non-finite guards the case where a future seed omits xpReward: an unmapped
  // value must land in the lowest tier, never `undefined`, or it sorts
  // unpredictably against every other achievement.
  if (!Number.isFinite(xpReward)) return 1;
  if (xpReward >= TIER_MINIMUMS[4]) return 4;
  if (xpReward >= TIER_MINIMUMS[3]) return 3;
  if (xpReward >= TIER_MINIMUMS[2]) return 2;
  return 1;
}
