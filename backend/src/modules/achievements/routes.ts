import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError } from '../../lib/errors';

export const achievementsRouter = Router();

achievementsRouter.get('/achievements', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const allAchievements = await prisma.achievement.findMany({
      orderBy: { threshold: 'asc' },
    });

    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const unlockedMap = new Map(
      userAchievements.map((ua) => [ua.achievementId, ua]),
    );

    const result = allAchievements.map((achievement) => {
      const unlocked = unlockedMap.get(achievement.id);
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
      };
    });

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

    const allAchievements = await prisma.achievement.findMany({
      orderBy: { threshold: 'asc' },
    });

    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const unlockedMap = new Map(
      userAchievements.map((ua) => [ua.achievementId, ua]),
    );

    const result = allAchievements.map((achievement) => {
      const unlocked = unlockedMap.get(achievement.id);
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
      };
    });

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
