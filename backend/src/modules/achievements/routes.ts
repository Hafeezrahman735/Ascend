import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { ensureAchievementCatalogue } from '../../lib/achievementCatalogue';
import { handleAuthError } from '../../lib/errors';
import { achievementProgress, BEHAVIOURAL_KEYS, type AchievementStats } from './handler';
import { deriveTier } from './tier';

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
  // Behavioural achievements ("complete a session before 8am") are binary
  // conditions carrying a placeholder threshold of 1, so the generic SESSIONS
  // counter reported them as 100% complete while permanently locked — which put
  // four dead entries at the front of any nearest-to-unlock ordering. They have
  // no partial progress: either the condition was met or it was not.
  const isBehavioural = BEHAVIOURAL_KEYS.has(achievement.key);
  const currentValue = isBehavioural
    ? (unlocked ? achievement.threshold : 0)
    : stats ? achievementProgress(achievement.category, stats) : 0;
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
    tier: deriveTier(achievement.xpReward),
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
