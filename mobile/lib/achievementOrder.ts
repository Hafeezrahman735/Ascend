import type { Achievement } from '../types';

/**
 * Ordering and selection for achievement surfaces.
 *
 * Pure and free of react-native imports on purpose: this is the only part of the
 * achievements UI that can be unit-tested (component rendering is deliberately
 * out of scope — see mobile/vitest.config.mts), and the ordering rule is exactly
 * the part where a mistake is visible to users but invisible in logs. It lived
 * inline in a 1500-line screen component before, where nothing could reach it.
 */

/** One achievement, flattened for display and ordered. */
export type OrderedAchievement = {
  key: string;
  icon: string;
  name: string;
  description: string;
  threshold: number;
  /** 0..1, server-computed from the same rule that decides the unlock. */
  progress: number;
  currentValue: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
  /** Server-derived difficulty tier, 1-4. */
  tier: 1 | 2 | 3 | 4;
  /** Top-tier achievements get the gold treatment. */
  isGold: boolean;
};

/** Achievements with no tier from the server sort as the lowest. */
const DEFAULT_TIER = 1;
const TOP_TIER = 4;

/**
 * Order: earned first (hardest first within that), then whatever is closest to
 * being earned. The second half is what makes the surface motivating rather than
 * decorative — the next thing to chase sits directly after what you already have.
 *
 * `tier` comes from the server (GET /achievements). The client deliberately does
 * NOT derive it: this screen previously computed its own `isGoldTier` from an
 * xpReward threshold that was duplicated from the backend, which is the same
 * class of drift bug the rank thresholds still have. If an older server omits
 * `tier`, nothing reads as gold rather than the client guessing.
 */
export function orderAchievements(achievements: Achievement[]): OrderedAchievement[] {
  const list: OrderedAchievement[] = achievements.map((a) => ({
    key: a.key,
    icon: a.icon,
    name: a.title,
    description: a.description,
    threshold: a.threshold,
    progress: a.isUnlocked ? 1 : (a.progress ?? 0),
    currentValue: a.currentValue ?? 0,
    isUnlocked: a.isUnlocked,
    unlockedAt: a.unlockedAt,
    tier: a.tier ?? DEFAULT_TIER,
    isGold: (a.tier ?? DEFAULT_TIER) === TOP_TIER,
  }));

  return list.sort((a, b) => {
    // Earned before unearned.
    if (a.isUnlocked !== b.isUnlocked) return a.isUnlocked ? -1 : 1;
    // Among earned, show off the hardest first.
    if (a.isUnlocked && a.tier !== b.tier) return b.tier - a.tier;
    // Among unearned, closest to unlocking first.
    if (!a.isUnlocked && a.progress !== b.progress) return b.progress - a.progress;
    // Stable, meaningful tie-break so the order cannot shuffle between renders.
    if (a.threshold !== b.threshold) return a.threshold - b.threshold;
    return a.key.localeCompare(b.key);
  });
}

/**
 * What a fixed-width row shows, plus how many it could not fit.
 *
 * `remaining` is rendered as a "+N more" affordance rather than leaving the row
 * to trail off the screen edge: a horizontal row with no terminal marker reads as
 * complete, so the rest of the catalogue becomes undiscoverable.
 */
export function selectRowAchievements(
  ordered: OrderedAchievement[],
  limit: number,
): { visible: OrderedAchievement[]; remaining: number } {
  if (limit <= 0) return { visible: [], remaining: ordered.length };
  return {
    visible: ordered.slice(0, limit),
    remaining: Math.max(0, ordered.length - limit),
  };
}

/** True when every achievement in the catalogue has been earned. */
export function allUnlocked(ordered: OrderedAchievement[]): boolean {
  return ordered.length > 0 && ordered.every((a) => a.isUnlocked);
}

/**
 * Keep a previously-rendered order stable while the same achievements are on
 * screen.
 *
 * A background refetch recomputes progress, and progress is part of the sort —
 * so without this, tiles can reorder under the user's finger mid-scroll for no
 * visible reason. Freezing on mount alone would be worse: a tab screen mounts
 * once per app session, so a newly-earned achievement would never appear.
 *
 * The compromise: reorder only when the SET of achievements changes (something
 * was earned, or the catalogue grew). Progress drift alone never reshuffles.
 */
export function stabilizeOrder(
  previousKeys: string[],
  next: OrderedAchievement[],
): OrderedAchievement[] {
  if (previousKeys.length !== next.length) return next;

  const byKey = new Map(next.map((a) => [a.key, a]));
  const preserved: OrderedAchievement[] = [];
  for (const key of previousKeys) {
    const match = byKey.get(key);
    // A key we no longer have means the set changed — fall back to the fresh order.
    if (!match) return next;
    preserved.push(match);
  }
  return preserved;
}
