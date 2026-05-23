import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';

export const goalsRouter = Router();

const createGoalSchema = z.object({
  type: z.enum(['daily', 'weekly']),
  targetCount: z.number().int().positive().optional(),
  targetHours: z.number().int().positive().optional(),
});

goalsRouter.post('/goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const data = createGoalSchema.parse(req.body);

    if (!data.targetCount && !data.targetHours) {
      res.status(400).json({
        success: false,
        error: 'Either targetCount or targetHours is required',
      });
      return;
    }

    const goal = await prisma.goal.create({
      data: {
        userId,
        type: data.type,
        targetCount: data.targetCount || null,
        targetHours: data.targetHours || null,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const periodEnd = new Date(today);
    if (data.type === 'daily') {
      periodEnd.setDate(periodEnd.getDate() + 1);
    } else {
      periodEnd.setDate(periodEnd.getDate() + 7);
    }

    await prisma.goalProgress.create({
      data: {
        goalId: goal.id,
        userId,
        currentCount: 0,
        periodStart: today,
        periodEnd,
      },
    });

    res.status(201).json({ success: true, data: goal });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Create goal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

goalsRouter.get('/goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const goals = await prisma.goal.findMany({
      where: { userId, isActive: true },
      include: {
        goalProgress: {
          orderBy: { periodStart: 'desc' },
          take: 1,
        },
      },
    });

    res.json({ success: true, data: goals });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get goals error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

goalsRouter.get('/goals/progress', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const dailySessions = await prisma.session.count({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: todayStart },
      },
    });

    const weeklySessions = await prisma.session.count({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: weekStart },
      },
    });

    const weeklySeconds = await prisma.session.aggregate({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: weekStart },
      },
      _sum: { durationSeconds: true },
    });

    const streak = await prisma.streak.findUnique({ where: { userId } });

    const goals = await prisma.goal.findMany({
      where: { userId, isActive: true },
      include: {
        goalProgress: {
          orderBy: { periodStart: 'desc' },
          take: 1,
        },
      },
    });

    const dailyGoal = goals.find((g) => g.type === 'daily');
    const weeklyGoal = goals.find((g) => g.type === 'weekly');

    res.json({
      success: true,
      data: {
        daily: {
          sessionsCompleted: dailySessions,
          goal: dailyGoal?.targetCount || null,
          progress: dailyGoal?.goalProgress[0]?.currentCount || dailySessions,
          targetCount: dailyGoal?.targetCount || null,
        },
        weekly: {
          sessionsCompleted: weeklySessions,
          focusHours: weeklySeconds._sum.durationSeconds
            ? Math.round((weeklySeconds._sum.durationSeconds / 3600) * 10) / 10
            : 0,
          goal: weeklyGoal?.targetHours || null,
          targetHours: weeklyGoal?.targetHours || null,
        },
        streak: {
          current: streak?.currentStreak || 0,
          longest: streak?.longestStreak || 0,
          lastSessionDate: streak?.lastSessionDate || null,
        },
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get progress error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

goalsRouter.put('/goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const schema = z.object({
      targetCount: z.number().int().positive().optional(),
      targetHours: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
    });
    const data = schema.parse(req.body);

    const goal = await prisma.goal.findFirst({
      where: { id, userId },
    });
    if (!goal) {
      res.status(404).json({ success: false, error: 'Goal not found' });
      return;
    }

    const updated = await prisma.goal.update({
      where: { id },
      data,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Update goal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

goalsRouter.delete('/goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: { id, userId },
    });
    if (!goal) {
      res.status(404).json({ success: false, error: 'Goal not found' });
      return;
    }

    await prisma.goal.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ success: true, data: { message: 'Goal deleted' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Delete goal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
