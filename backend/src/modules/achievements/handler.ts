import {
  SessionCompletedEvent,
  GoalCompletedEvent,
  FriendGoalCompletedEvent,
  eventBus,
  EventTypes,
} from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { getFriendCount } from '../../services/friendshipService';

export async function checkAchievements(
  userId: string,
  currentStreak: number,
  totalSessions: number,
  totalFocusTime: number,
  level: number,
): Promise<{ id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[]> {
  const allAchievements = await prisma.achievement.findMany();
  const userAchievements = await prisma.userAchievement.findMany({
    where: { userId },
  });
  const unlockedKeys = new Set(userAchievements.map((ua) => ua.achievementId));

  const newlyUnlocked: { id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: Date }[] = [];

  for (const achievement of allAchievements) {
    if (unlockedKeys.has(achievement.id)) continue;

    let shouldUnlock = false;

    switch (achievement.category) {
      case 'STREAK':
        shouldUnlock = currentStreak >= achievement.threshold;
        break;
      case 'SESSIONS':
        shouldUnlock = totalSessions >= achievement.threshold;
        break;
      case 'FOCUS_TIME':
        shouldUnlock = Math.floor(totalFocusTime / 60) >= achievement.threshold;
        break;
      case 'LEVEL':
        shouldUnlock = level >= achievement.threshold;
        break;
    }

    if (shouldUnlock) {
      const unlocked = await prisma.userAchievement.create({
        data: { userId, achievementId: achievement.id, isShared: false },
        select: { unlockedAt: true },
      });

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

export async function handleFriendGoalCompleted(
  payload: FriendGoalCompletedEvent,
): Promise<void> {
  const friendIds = payload.friendIds || [];
  const allAchievements = await prisma.achievement.findMany();
  const accountabilityAchievement = allAchievements.find((a) => a.key === 'accountability-partner');
  if (!accountabilityAchievement) return;

  for (const friendId of friendIds) {
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId: friendId,
          achievementId: accountabilityAchievement.id,
        },
      },
    });
    if (existing) continue;

    const unlocked = await prisma.userAchievement.create({
      data: { userId: friendId, achievementId: accountabilityAchievement.id, isShared: false },
      include: { achievement: true },
    });

    eventBus.emit(EventTypes.ACHIEVEMENT_UNLOCKED, {
      userId: friendId,
      achievementId: accountabilityAchievement.id,
      slug: accountabilityAchievement.key,
      title: accountabilityAchievement.title,
      unlockedAt: unlocked.unlockedAt.toISOString(),
    });
  }
}

export async function handleSessionCompleted(
  payload: SessionCompletedEvent,
): Promise<void> {
  const userId = payload.userId;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const allAchievements = await prisma.achievement.findMany();
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
      const unlocked = await prisma.userAchievement.create({
        data: { userId, achievementId: achievement.id, isShared: false },
        include: { achievement: true },
      });

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

export async function handleGoalCompleted(
  payload: GoalCompletedEvent,
): Promise<void> {
  const userId = payload.userId;
  const allAchievements = await prisma.achievement.findMany();
  const userAchievements = await prisma.userAchievement.findMany({
    where: { userId },
  });
  const unlockedIds = new Set(userAchievements.map((ua) => ua.achievementId));

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const friendCount = await getFriendCount(userId);

  for (const achievement of allAchievements) {
    if (unlockedIds.has(achievement.id)) continue;

    let shouldUnlock = false;

    switch (achievement.key) {
      case 'social-butterfly':
        shouldUnlock = friendCount >= 5;
        break;
      default:
        break;
    }

    if (shouldUnlock) {
      const unlocked = await prisma.userAchievement.create({
        data: { userId, achievementId: achievement.id, isShared: false },
        include: { achievement: true },
      });

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
