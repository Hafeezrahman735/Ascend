import {
  SessionCompletedEvent,
  eventBus,
  EventTypes,
} from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { IMMEDIATE, type Effects } from '../../lib/transaction';
import { ensureAchievementCatalogue } from '../../lib/achievementCatalogue';
import { localHourIn } from '../../lib/localParts';

/** Early Bird: a session completed before 08:00 local time. */
const EARLY_BIRD_BEFORE_HOUR = 8;
/** Night Owl: a session completed at 22:00 local time or later. */
const NIGHT_OWL_FROM_HOUR = 22;
/** Speed Runner: this many focus sessions on one local day. */
const SPEED_RUNNER_SESSIONS = 8;
/** Marathon: this much focus on one local day. */
const MARATHON_SECONDS = 4 * 3600;

/**
 * Unlock an achievement, returning null if the user already had it.
 *
 * Every caller first reads the user's unlocked set, then inserts — so two
 * sessions completing at the same moment both see "not unlocked" and both try to
 * insert. The @@unique([userId, achievementId]) constraint makes the loser throw
 * P2002. Uncaught, that surfaced as a 500 from /timer/complete *after* the
 * session row was written and XP awarded, so the user saw an error for work that
 * had actually been saved.
 *
 * Losing the race is a normal outcome, not a failure: it just means the
 * achievement is already unlocked, so we skip it and emit no duplicate event.
 *
 * The insert skips the duplicate (ON CONFLICT DO NOTHING) rather than catching
 * P2002, because inside a transaction a failed statement aborts the whole
 * transaction — the XP and goal writes around it would be lost too.
 */
async function tryUnlockAchievement(
  db: Effects['db'],
  userId: string,
  achievementId: string,
): Promise<{ unlockedAt: Date } | null> {
  const unlockedAt = new Date();
  const { count } = await db.userAchievement.createMany({
    data: [{ userId, achievementId, isShared: false, unlockedAt }],
    skipDuplicates: true,
  });
  return count === 1 ? { unlockedAt } : null;
}

/**
 * The user counters every achievement threshold is measured against.
 *
 * Passed as an object rather than positional arguments — it grew past the point
 * where five bare numbers at a call site were readable.
 */
export interface AchievementStats {
  currentStreak: number;
  totalSessions: number;
  totalFocusTime: number; // seconds
  /** Drives the RANK category: rank is a band of XP, so XP is the raw number. */
  xp: number;
  tasksCompleted: number;
}

/**
 * The user's current value for an achievement's category — the number its
 * `threshold` is compared against.
 *
 * Shared by the unlock check and GET /achievements so the progress the client
 * displays is computed by exactly the same rule that decides the unlock. If they
 * were written twice they would eventually disagree.
 */
export function achievementProgress(category: string, stats: AchievementStats): number {
  switch (category) {
    case 'STREAK':     return stats.currentStreak;
    case 'SESSIONS':   return stats.totalSessions;
    // Thresholds for this category are expressed in HOURS — the seed titles say
    // "Accumulate N hours" and carry threshold: N. This divided by 60 (seconds ->
    // minutes) and compared minutes against an hours threshold, so "One Hundred
    // Hours" unlocked after 100 minutes. Already-unlocked rows are left alone:
    // achievements are never revoked in this system.
    case 'FOCUS_TIME': return Math.floor(stats.totalFocusTime / 3600);
    // RANK thresholds are XP values (see prisma/seed.ts) because rank IS a band
    // of XP. This replaced a LEVEL category whose thresholds were level numbers;
    // Level is gone, and the two achievements that used it were re-pointed at
    // the equivalent rank thresholds rather than deleted, so nobody loses an
    // unlock they earned.
    case 'RANK':       return stats.xp;
    case 'TASKS':      return stats.tasksCompleted;
    default:           return 0;
  }
}

/**
 * Achievements whose unlock condition is bespoke rather than a counter
 * threshold — they are evaluated by key in handleSessionCompleted below.
 *
 * They must be skipped by the generic threshold check: they carry a placeholder
 * threshold of 1, so treating them as ordinary counter achievements would unlock
 * every one of them the moment a user completed a single session.
 */
export const BEHAVIOURAL_KEYS = new Set([
  'social-butterfly',
  'early-bird',
  'night-owl',
  'speed-runner',
  'marathon',
]);

/**
 * Unlock every threshold achievement the stats have reached. Pass `effects` to
 * run inside a caller's transaction; the feed events then wait for its commit.
 */
export async function checkAchievements(
  userId: string,
  stats: AchievementStats,
  effects: Effects = IMMEDIATE,
): Promise<{ id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[]> {
  const allAchievements = await ensureAchievementCatalogue();
  const userAchievements = await effects.db.userAchievement.findMany({
    where: { userId },
  });
  const unlockedKeys = new Set(userAchievements.map((ua) => ua.achievementId));

  const newlyUnlocked: { id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[] = [];

  for (const achievement of allAchievements) {
    if (unlockedKeys.has(achievement.id)) continue;
    if (BEHAVIOURAL_KEYS.has(achievement.key)) continue;

    // TASKS is now covered — the category existed in the schema enum from the
    // start but had no branch here and nothing seeded against it.
    const shouldUnlock =
      achievementProgress(achievement.category, stats) >= achievement.threshold;

    if (shouldUnlock) {
      const unlocked = await tryUnlockAchievement(effects.db, userId, achievement.id);
      if (!unlocked) continue; // already unlocked by a concurrent session

      newlyUnlocked.push({
        id: achievement.id,
        key: achievement.key,
        title: achievement.title,
        description: achievement.description,
        icon: achievement.icon,
        xpReward: achievement.xpReward,
        category: achievement.category,
        threshold: achievement.threshold,
        unlockedAt: unlocked.unlockedAt,
      });

      effects.events.emit(EventTypes.FEED_CREATE, {
        userId,
        eventType: 'achievement_unlocked',
        payload: {
          achievementTitle: achievement.title,
          achievementIcon: achievement.icon,
          achievementDescription: achievement.description,
        },
      });
    }
  }

  return newlyUnlocked;
}

// ─── Removed: handleFriendGoalCompleted / accountability-partner ─────────────
// This unlocked the 'accountability-partner' achievement when a friend completed
// a goal, driven by FRIEND_GOAL_COMPLETED from the session-target goal system.
// That system has been deleted, and TaskGoal — the goal system users can
// actually reach — has no concept of a shared or friend-visible goal: it groups
// one user's own tasks. There is nothing to attach a friend-completion event to.
//
// Rather than invent a sharing mechanism to keep the achievement alive,
// 'accountability-partner' stays unseeded/disabled until goal sharing is a
// designed feature. It was never seeded in prisma/seed.ts, so no user has ever
// held it and none can lose it. See the note in prisma/seed.ts.

export async function handleSessionCompleted(
  payload: SessionCompletedEvent,
): Promise<void> {
  const userId = payload.userId;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return;

  const allAchievements = await ensureAchievementCatalogue();
  const userAchievements = await prisma.userAchievement.findMany({
    where: { userId },
  });
  const unlockedIds = new Set(userAchievements.map((ua) => ua.achievementId));

  // 'social-butterfly' used to count accepted friendships. Friendships are gone —
  // no screen could ever create one — so it counts follows instead. Same idea,
  // same threshold, on the social graph that actually exists. Anyone who already
  // unlocked it keeps it; this only decides FUTURE unlocks.
  const followingCount = await prisma.follow.count({ where: { followerId: userId } });

  // Null without a valid zone from the client: an hour-of-day achievement is
  // not awarded on a guess. Every app build that ships sends one.
  const localHour = localHourIn(new Date(payload.completedAt), payload.timeZone);

  // The day this session belongs to, in the user's calendar — the same
  // localDate the session row is stamped with and streaks are counted on.
  // Loaded at most once, and only if a day-total achievement is still locked.
  let dayTotals: { count: number; seconds: number } | null = null;
  const sessionDayTotals = async () => {
    if (!dayTotals) {
      const agg = await prisma.session.aggregate({
        where: { userId, type: 'focus', localDate: payload.localDate },
        _count: { _all: true },
        _sum: { durationSeconds: true },
      });
      dayTotals = { count: agg._count._all, seconds: agg._sum.durationSeconds ?? 0 };
    }
    return dayTotals;
  };

  for (const achievement of allAchievements) {
    if (unlockedIds.has(achievement.id)) continue;

    let shouldUnlock = false;

    switch (achievement.key) {
      case 'social-butterfly':
        shouldUnlock = followingCount >= 5;
        break;
      // The hour and the day are the USER'S, not the server's. These used
      // getHours() and setHours(0) on the server clock, which is UTC on
      // Railway: a Chicago user's 7pm session counted as "before 8am", and a
      // US evening's sessions were split across two "days".
      case 'early-bird':
        shouldUnlock = localHour !== null && localHour < EARLY_BIRD_BEFORE_HOUR;
        break;
      case 'night-owl':
        shouldUnlock = localHour !== null && localHour >= NIGHT_OWL_FROM_HOUR;
        break;
      case 'speed-runner':
        shouldUnlock = (await sessionDayTotals()).count >= SPEED_RUNNER_SESSIONS;
        break;
      case 'marathon':
        shouldUnlock = (await sessionDayTotals()).seconds >= MARATHON_SECONDS;
        break;
      default:
        break;
    }

    if (shouldUnlock) {
      const unlocked = await tryUnlockAchievement(prisma, userId, achievement.id);
      if (!unlocked) continue; // already unlocked by a concurrent event

      eventBus.emit(EventTypes.ACHIEVEMENT_UNLOCKED, {
        userId,
        achievementId: achievement.id,
        slug: achievement.key,
        title: achievement.title,
        unlockedAt: unlocked.unlockedAt.toISOString(),
      });
    }
  }
}

// ─── Removed: handleGoalCompleted ────────────────────────────────────────────
// Listened for GOAL_COMPLETED from the deleted session-target goal system, and
// only ever checked 'social-butterfly' — which handleSessionCompleted above
// already evaluates on every focus session, so nothing is lost by removing it.
