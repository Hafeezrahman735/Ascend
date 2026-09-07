/**
 * The shape of a demo account's focus history.
 *
 * A profile shows currentStreak, longestStreak and totalSessions as three
 * independent numbers, and seeding them as three independent numbers is exactly
 * how a demo account ends up claiming a 34-day streak over an empty calendar.
 * Two screens then disagree, and the calendar is the one telling the truth.
 *
 * So the days are laid out to PRODUCE those three numbers, and the seeder
 * writes the user row from what it actually created. This module owns that
 * layout because it is the part with an invariant worth testing: everything
 * around it in prisma/seed-demo-users.ts is copy and flavour.
 *
 * It lives in src/lib rather than beside the seeder for the same reason
 * backfillGoalCompletion does — pure logic the test suite can reach. Nothing on
 * a request path imports it.
 */

/** How far back a generated history reaches. Twelve weeks fills a month view in
 *  either scroll direction and stays inside both retention windows (activity
 *  180d, notifications 90d), so nothing seeded is pruned on the first write the
 *  account makes. */
export const HISTORY_DAYS = 84;

/** Nobody in the demo does more than this in a day. Six 50-minute blocks is
 *  already a heavy day; more starts to look like generated data, which it is. */
export const MAX_SESSIONS_PER_DAY = 6;

/** What the layout needs to know about an account. */
export interface HistoryShape {
  /** Distinguishes one account's history from another's. The username. */
  seed: string;
  currentStreak: number;
  longestStreak: number;
  /** A target. Reached whenever the day layout has room for it — see
   *  sessionCountByDay, which is the authority on what was actually placed. */
  totalSessions: number;
}

/**
 * Stable pseudo-random in [0,1) from a string.
 *
 * Everything variable in the demo seed is derived from this rather than
 * hand-written, so five accounts get a season's texture without hundreds of
 * literal edits — and it is deterministic, so re-running the seed does not
 * reshuffle anyone's history out from under a screenshot.
 */
export function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Which days this account worked, counting back from today (0 = today).
 *
 *   days 0 … currentStreak-1        worked — the live streak, ending today
 *   day  currentStreak              rest — this is the day that ended it
 *   the next longestStreak days     worked — the record run
 *   the day after that              rest — so the record is bounded
 *   everything older                worked about two days in three
 *
 * The older stretch is capped so it can never accidentally beat the record and
 * make longestStreak wrong, and it stops once there are as many worked days as
 * there are sessions to put on them: a worked day with no session is not a day
 * anyone worked.
 */
export function workedDays(shape: HistoryShape): number[] {
  const worked = new Set<number>();
  for (let d = 0; d < shape.currentStreak; d += 1) worked.add(d);

  const recordStart = shape.currentStreak + 1;
  const recordEnd = recordStart + shape.longestStreak; // exclusive
  for (let d = recordStart; d < recordEnd; d += 1) worked.add(d);

  // recordEnd itself is the rest day that closes the record run.
  let run = 0;
  for (let d = recordEnd + 1; d < HISTORY_DAYS && worked.size < shape.totalSessions; d += 1) {
    if (run >= shape.longestStreak) {
      run = 0; // forced rest, so the record stands
      continue;
    }
    if (hashUnit(`${shape.seed}:worked:${d}`) < 0.62) {
      worked.add(d);
      run += 1;
    } else {
      run = 0;
    }
  }

  return [...worked].sort((a, b) => a - b);
}

/**
 * How many sessions land on each worked day, keyed by days-ago.
 *
 * One on every worked day, then the remainder spread with a recency bias — a
 * demo whose busiest week was three months ago reads as an account somebody
 * gave up on.
 *
 * The allocation is proportional rather than a repeated per-day lottery. A
 * lottery reads more naturally and cannot finish: hashUnit is a pure function
 * of its seed, so a day rejected at a given count is rejected at that count
 * forever, and the pass stalls with sessions still to place. That silently cost
 * the two heaviest demo accounts a third of their history.
 */
export function sessionCountByDay(shape: HistoryShape): Map<number, number> {
  const days = workedDays(shape);
  const counts = new Map<number, number>(days.map((d) => [d, 1]));
  const extra = shape.totalSessions - days.length;
  let remaining = extra;

  const weightOf = (d: number) => 0.35 + 0.65 * (1 - d / HISTORY_DAYS);
  const totalWeight = days.reduce((sum, d) => sum + weightOf(d), 0);

  for (const d of days) {
    if (remaining <= 0) break;
    const share = Math.min(
      MAX_SESSIONS_PER_DAY - 1,
      remaining,
      Math.floor((extra * weightOf(d)) / totalWeight),
    );
    counts.set(d, 1 + share);
    remaining -= share;
  }

  // `days` is sorted most-recent first, so whatever rounding left over lands on
  // the days nearest today rather than trailing off into last quarter.
  for (const d of days) {
    if (remaining <= 0) break;
    const current = counts.get(d) ?? 1;
    const add = Math.min(MAX_SESSIONS_PER_DAY - current, remaining);
    counts.set(d, current + add);
    remaining -= add;
  }

  return counts;
}
