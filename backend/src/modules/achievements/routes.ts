import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { ensureAchievementCatalogue } from '../../lib/achievementCatalogue';
import { handleAuthError } from '../../lib/errors';
import { achievementProgress, type AchievementStats } from './handler';

export const achievementsRouter = Router();

/** The counters achievement thresholds are measured against, for one user. */
async function loadAchievementStats(userId: string): Promise<AchievementStats | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentStreak: true,
      totalSessions: true,
      totalFocusTime: true,
      level: true,
      tasksCompleted: true,
    },
  });
  return user ?? null;
}

/**
 * Shape one achievement for the client, including how far along the user is.
 *
 * Returning `currentValue` alongside `threshold` is what lets the client render
 * "7 / 10 sessions" progress instead of a bare locked icon — the numbers already
 * existed server-side, they just were not being sent.
 */
function serializeAchievement(
  achievement: {
    id: string; key: string; title: string; description: string;
    icon: string; xpReward: number; category: string; threshold: number;
  },
  unlocked: { unlockedAt: Date; isShared: boolean } | undefined,
  stats: AchievementStats | null,
) {
  const currentValue = stats ? achievementProgress(achievement.category, stats) : 0;
  // Unlocked achievements always read as full, even if the underlying counter
  // later fell (a streak resets, a task is un-completed) — the achievement was
  // genuinely earned and is never revoked.
  const cappedValue = unlocked ? achievement.threshold : Math.min(currentValue, achievement.threshold);

  return {
    id: achievement.id,
    key: achievement.key,
    title: achievement.title,
    description: achievement.description,
    icon: achievement.icon,
    xpReward: achievement.xpReward,
    category: achievement.category,
    threshold: achievement.threshold,
    isUnlocked: !!unlocked,
    unlockedAt: unlocked?.unlockedAt || null,
    isShared: unlocked?.isShared || false,
    currentValue: cappedValue,
    progress: achievement.threshold > 0 ? cappedValue / achievement.threshold : 0,
  };
}

achievementsRouter.get('/achievements', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const [allAchievements, userAchievements, stats] = await Promise.all([
      ensureAchievementCatalogue(),
      prisma.userAchievement.findMany({ where: { userId } }),
      loadAchievementStats(userId),
    ]);

    const unlockedMap = new Map(
      userAchievements.map((ua) => [ua.achievementId, ua]),
    );

    const result = allAchievements.map((achievement) =>
      serializeAchievement(achievement, unlockedMap.get(achievement.id), stats),
    );

    res.json({ success: true, data: result });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get my achievements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

achievementsRouter.get('/achievements/:userId', async (req: Request, res: Response) => {
  try {
    const authUserId = authenticate(req);
    const { userId } = req.params;

    if (authUserId !== userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { privacySetting: true },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      if (targetUser.privacySetting === 'private') {
        res.status(403).json({ success: false, error: 'This user\'s achievements are private' });
        return;
      }
    }

    const [allAchievements, userAchievements, stats] = await Promise.all([
      ensureAchievementCatalogue(),
      prisma.userAchievement.findMany({ where: { userId } }),
      loadAchievementStats(userId),
    ]);

    const unlockedMap = new Map(
      userAchievements.map((ua) => [ua.achievementId, ua]),
    );

    const result = allAchievements.map((achievement) =>
      serializeAchievement(achievement, unlockedMap.get(achievement.id), stats),
    );

    res.json({ success: true, data: result });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get achievements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

achievementsRouter.patch('/achievements/:id/share', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const userAchievement = await prisma.userAchievement.findFirst({
      where: { id, userId },
    });
    if (!userAchievement) {
      res.status(404).json({ success: false, error: 'Achievement not found' });
      return;
    }

    const updated = await prisma.userAchievement.update({
      where: { id },
      data: { isShared: !userAchievement.isShared },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Share achievement error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
