import { SessionCompletedEvent, eventBus, EventTypes } from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { getFriendIds } from '../social/service';
import { calculateXP, calculateLevel } from '../../lib/xp';
import { updateStreak } from '../../lib/streak';
import { checkAchievements } from '../achievements/handler';

function getStreakIncrement(
  lastSessionDate: Date | null,
  currentStreak: number,
): { currentStreak: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const lastStr = lastSessionDate
    ? new Date(lastSessionDate).toISOString().split('T')[0]
    : null;

  if (lastStr === todayStr) {
    return { currentStreak: currentStreak || 0 };
  }

  if (lastStr) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (lastStr === yesterdayStr) {
      return { currentStreak: (currentStreak || 0) + 1 };
    }
    return { currentStreak: 1 };
  }

  return { currentStreak: 1 };
}

export async function runGamification(
  userId: string,
  elapsedSeconds: number,
  completedAt: Date,
): Promise<{
  xpEarned: number;
  totalXP: number;
  level: number;
  leveledUp: boolean;
  newStreak: number;
  longestStreak: number;
  newlyUnlocked: { id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[];
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const { streak, longestStreak: newLongest, isNewDay } = updateStreak(
    user.lastActiveDate,
    user.currentStreak,
    user.longestStreak,
    completedAt,
  );

  const xpEarned = calculateXP(elapsedSeconds, streak);
  let newTotalXP = user.xp + xpEarned;
  let newLevel = calculateLevel(newTotalXP);
  const leveledUp = newLevel > user.level;

  const newlyUnlocked = await checkAchievements(
    userId,
    streak,
    user.totalSessions + 1,
    user.totalFocusTime + elapsedSeconds,
    newLevel,
  );

  for (const achievement of newlyUnlocked) {
    newTotalXP += achievement.xpReward;
  }
  newLevel = calculateLevel(newTotalXP);

  const updateData: Record<string, unknown> = {
    xp: newTotalXP,
    level: newLevel,
    currentStreak: streak,
    longestStreak: newLongest,
    totalSessions: { increment: 1 } as never,
    totalFocusTime: { increment: elapsedSeconds } as never,
  };
  if (isNewDay) {
    updateData.lastActiveDate = completedAt;
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData as never,
  });

  return {
    xpEarned,
    totalXP: newTotalXP,
    level: newLevel,
    leveledUp,
    newStreak: streak,
    longestStreak: newLongest,
    newlyUnlocked,
  };
}

export async function handleSessionCompleted(payload: SessionCompletedEvent): Promise<void> {
  if (payload.type !== 'focus') return;

  const userId = payload.userId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const activeGoals = await prisma.goal.findMany({
    where: { userId, isActive: true },
  });

  for (const goal of activeGoals) {
    const periodStart = goal.type === 'daily' ? today : weekStart;
    const periodEnd = goal.type === 'daily' ? tomorrow : new Date(weekStart.getTime() + 7 * 86400000);

    let progress = await prisma.goalProgress.findFirst({
      where: { goalId: goal.id, periodStart, periodEnd },
    });

    if (!progress) {
      progress = await prisma.goalProgress.create({
        data: {
          goalId: goal.id,
          userId,
          currentCount: 1,
          periodStart,
          periodEnd,
        },
      });
    } else {
      progress = await prisma.goalProgress.update({
        where: { id: progress.id },
        data: { currentCount: { increment: 1 } },
      });
    }

    const target = goal.targetCount || 0;
    if (target > 0 && progress.currentCount >= target && !progress.completedAt) {
      await prisma.goalProgress.update({
        where: { id: progress.id },
        data: { completedAt: new Date() },
      });

      eventBus.emit(EventTypes.GOAL_COMPLETED, {
        userId,
        goalId: goal.id,
        goalType: goal.type as 'daily' | 'weekly',
        targetValue: target,
        period: periodStart.toISOString(),
      });

      const friendIds = await getFriendIds(userId);
      if (friendIds.length > 0) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });

        eventBus.emit(EventTypes.FRIEND_GOAL_COMPLETED, {
          userId,
          friendIds,
          goalType: goal.type as 'daily' | 'weekly',
          username: user?.username || 'Unknown',
          completedAt: new Date().toISOString(),
        });
      }
    }
  }

  const existingStreak = await prisma.streak.findUnique({ where: { userId } });
  const { currentStreak } = getStreakIncrement(
    existingStreak?.lastSessionDate || null,
    existingStreak?.currentStreak || 0,
  );
  const longestStreak = Math.max(currentStreak, existingStreak?.longestStreak || 0);

  await prisma.streak.upsert({
    where: { userId },
    create: {
      userId,
      currentStreak,
      longestStreak,
      lastSessionDate: payload.completedAt ? new Date(payload.completedAt) : new Date(),
    },
    update: {
      currentStreak,
      longestStreak,
      lastSessionDate: payload.completedAt ? new Date(payload.completedAt) : new Date(),
    },
  });
}
