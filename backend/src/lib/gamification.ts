import { prisma } from './prisma';
import { calculateXP } from './xp';
import { getRankTitle } from './rank';
import { updateStreak } from './streak';
import { utcDateStr } from './localDate';
import { eventBus, EventTypes } from '../middleware/eventBus';
import { checkAchievements } from '../modules/achievements/handler';

export interface XpAward {
  xpEarned: number;
  totalXP: number;
  rank: string;
  rankedUp: boolean;
  newlyUnlocked: Awaited<ReturnType<typeof checkAchievements>>;
}

/**
 * Apply an XP change from something other than a focus session — completing a
 * task or a goal — and keep every derived value in step.
 *
 * Sessions go through runGamification below, which also moves streaks. This is
 * the lighter path: XP, the rank-up activity event, and an achievement sweep.
 * Both funnel through the same getRankTitle/checkAchievements so a rank earned
 * by finishing a task is indistinguishable from one earned by focusing.
 *
 * Rank replaced Level here. They were two ladders over the same XP — one shown
 * on the profile, one on every post — which meant two numbers claiming to
 * describe the same progress. Rank is the one users actually see.
 *
 * `deltaXp` may be negative: un-checking a task revokes what completing it
 * granted, so the two are a true undo pair and repeated toggling can't farm XP.
 */
export async function awardXp(
  userId: string,
  deltaXp: number,
  options: { tasksCompletedDelta?: number } = {},
): Promise<XpAward | null> {
  const { tasksCompletedDelta = 0 } = options;
  if (deltaXp === 0 && tasksCompletedDelta === 0) return null;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, currentStreak: true, totalSessions: true, totalFocusTime: true },
  });
  if (!before) return null;

  // Clamp so a revoke can never drive either counter negative.
  const nextXp = Math.max(0, before.xp + deltaXp);
  const previousRank = getRankTitle(before.xp);
  const nextRank = getRankTitle(nextXp);
  const rankedUp = nextRank !== previousRank && nextXp > before.xp;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      xp: nextXp,
      ...(tasksCompletedDelta !== 0
        ? { tasksCompleted: { increment: tasksCompletedDelta } }
        : {}),
    },
    select: { tasksCompleted: true },
  });

  // Guard the floor separately — `increment` cannot clamp.
  if (updated.tasksCompleted < 0) {
    await prisma.user.update({ where: { id: userId }, data: { tasksCompleted: 0 } });
  }

  if (rankedUp) {
    eventBus.emit(EventTypes.FEED_CREATE, {
      userId,
      eventType: 'rank_up',
      payload: { rank: nextRank },
    });
  }

  // Only sweep achievements when something could have crossed a threshold.
  const newlyUnlocked =
    deltaXp > 0 || tasksCompletedDelta > 0
      ? await checkAchievements(userId, {
          currentStreak: before.currentStreak,
          totalSessions: before.totalSessions,
          totalFocusTime: before.totalFocusTime,
          xp: nextXp,
          tasksCompleted: Math.max(0, updated.tasksCompleted),
        })
      : [];

  return { xpEarned: deltaXp, totalXP: nextXp, rank: nextRank, rankedUp, newlyUnlocked };
}

/**
 * Awards XP, advances level and streak, and unlocks achievements for one
 * completed focus session. Called synchronously from POST /timer/complete.
 *
 * This used to live in modules/goals/handler.ts alongside the session-target
 * goal system. That system has been removed; this engine is unrelated to goals
 * and now sits with the other scoring primitives (xp.ts, streak.ts).
 */
export async function runGamification(
  userId: string,
  elapsedSeconds: number,
  completedAt: Date,
  localDate?: string, // YYYY-MM-DD in the user's local timezone; falls back to UTC date
): Promise<{
  xpEarned: number;
  totalXP: number;
  rank: string;
  rankedUp: boolean;
  newStreak: number;
  longestStreak: number;
  newlyUnlocked: { id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[];
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const sessionLocalDate = localDate ?? utcDateStr(completedAt);

  const { streak, longestStreak: newLongest, isNewDay } = updateStreak(
    user.lastActiveDate,
    user.currentStreak,
    user.longestStreak,
    sessionLocalDate,
  );

  const xpEarned = calculateXP(elapsedSeconds, streak);
  let newTotalXP = user.xp + xpEarned;
  const previousRank = getRankTitle(user.xp);

  const newlyUnlocked = await checkAchievements(userId, {
    currentStreak: streak,
    totalSessions: user.totalSessions + 1,
    totalFocusTime: user.totalFocusTime + elapsedSeconds,
    xp: newTotalXP,
    tasksCompleted: user.tasksCompleted,
  });

  // Achievement rewards are XP too, so they can carry you over a rank threshold
  // in the same request that unlocked them. Rank is resolved AFTER they land.
  for (const achievement of newlyUnlocked) {
    newTotalXP += achievement.xpReward;
  }
  const newRank = getRankTitle(newTotalXP);
  const rankedUp = newRank !== previousRank;

  const updateData: Record<string, unknown> = {
    xp: newTotalXP,
    currentStreak: streak,
    longestStreak: newLongest,
    totalSessions: { increment: 1 },
    totalFocusTime: { increment: elapsedSeconds },
  };
  if (isNewDay) {
    // Store as midnight UTC of the local date so future comparisons via toLocalDateStr() are stable.
    updateData.lastActiveDate = new Date(sessionLocalDate + 'T00:00:00.000Z');
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData as never,
  });

  return {
    xpEarned,
    totalXP: newTotalXP,
    rank: newRank,
    rankedUp,
    newStreak: streak,
    longestStreak: newLongest,
    newlyUnlocked,
  };
}
