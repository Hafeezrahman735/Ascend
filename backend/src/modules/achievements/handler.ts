import {
  SessionCompletedEvent,
  eventBus,
  EventTypes,
} from '../../middleware/eventBus';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ensureAchievementCatalogue } from '../../lib/achievementCatalogue';
import { getFriendCount } from '../../services/friendshipService';

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
 * Any other error still propagates.
 */
async function tryUnlockAchievement(
  userId: string,
  achievementId: string,
): Promise<{ unlockedAt: Date } | null> {
  try {
    return await prisma.userAchievement.create({
      data: { userId, achievementId, isShared: false },
      select: { unlockedAt: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    throw err;
  }
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
  level: number;
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
    // Thresholds for this category are expressed in minutes.
    case 'FOCUS_TIME': return Math.floor(stats.totalFocusTime / 60);
    case 'LEVEL':      return stats.level;
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
const BEHAVIOURAL_KEYS = new Set([
  'social-butterfly',
  'early-bird',
  'night-owl',
  'speed-runner',
  'marathon',
]);

export async function checkAchievements(
  userId: string,
  stats: AchievementStats,
): Promise<{ id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[]> {
  const allAchievements = await ensureAchievementCatalogue();
  const userAchievements = await prisma.userAchievement.findMany({
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
      const unlocked = await tryUnlockAchievement(userId, achievement.id);
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

      eventBus.emit(EventTypes.FEED_CREATE, {
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

  const friendCount = await getFriendCount(userId);

  for (const achievement of allAchievements) {
    if (unlockedIds.has(achievement.id)) continue;

    let shouldUnlock = false;

    switch (achievement.key) {
      case 'social-butterfly':
        shouldUnlock = friendCount >= 5;
        break;
      case 'early-bird':
        {
          const hour = new Date(payload.completedAt).getHours();
          shouldUnlock = hour < 8;
        }
        break;
      case 'night-owl':
        {
          const hour = new Date(payload.completedAt).getHours();
          shouldUnlock = hour >= 22;
        }
        break;
      case 'speed-runner':
        {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const todayCount = await prisma.session.count({
            where: { userId, type: 'focus', completedAt: { gte: today, lt: tomorrow } },
          });
          shouldUnlock = todayCount >= 8;
        }
        break;
      case 'marathon':
        {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const todaySessions = await prisma.session.findMany({
            where: { userId, type: 'focus', completedAt: { gte: today, lt: tomorrow } },
          });
          const todayTotalSeconds = todaySessions.reduce((sum, s) => sum + s.durationSeconds, 0);
          shouldUnlock = todayTotalSeconds >= 4 * 3600;
        }
        break;
      default:
        break;
    }

    if (shouldUnlock) {
      const unlocked = await tryUnlockAchievement(userId, achievement.id);
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
