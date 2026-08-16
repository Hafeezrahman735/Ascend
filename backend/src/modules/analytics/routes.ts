import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError } from '../../lib/errors';
import { getFriendIds } from '../../services/friendshipService';
import { getFriendSummary } from './service';

export const analyticsRouter = Router();

analyticsRouter.get('/analytics/summary/:userId', async (req: Request, res: Response) => {
  try {
    const requestingUserId = authenticate(req);
    const { userId } = req.params;
    const data = await getFriendSummary(requestingUserId, userId);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof Error && (error.message === 'This user\'s stats are private' || error.message === 'User not found')) {
      res.status(403).json({ success: false, error: error.message });
      return;
    }
    if (handleAuthError(res, error)) return;
    console.error('Friend summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/daily', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    const sessions = await prisma.session.findMany({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: startDate },
      },
      select: { completedAt: true, durationSeconds: true },
      orderBy: { completedAt: 'asc' },
    });

    const grouped: Record<string, { totalSessions: number; totalMinutes: number }> = {};
    for (const s of sessions) {
      const dateKey = s.completedAt.toISOString().split('T')[0];
      if (!grouped[dateKey]) {
        grouped[dateKey] = { totalSessions: 0, totalMinutes: 0 };
      }
      grouped[dateKey].totalSessions += 1;
      grouped[dateKey].totalMinutes += Math.round(s.durationSeconds / 60);
    }

    const data: { date: string; totalSessions: number; totalMinutes: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateKey = d.toISOString().split('T')[0];
      data.push({
        date: dateKey,
        totalSessions: grouped[dateKey]?.totalSessions || 0,
        totalMinutes: grouped[dateKey]?.totalMinutes || 0,
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Daily analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/weekly', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sessions = await prisma.session.findMany({
      where: {
        userId,
        type: 'focus',
      },
      select: { completedAt: true, durationSeconds: true },
      orderBy: { completedAt: 'asc' },
    });

    const grouped: Record<string, { totalSessions: number; totalMinutes: number }> = {};
    for (const s of sessions) {
      const d = new Date(s.completedAt);
      d.setDate(d.getDate() - d.getDay());
      const weekKey = d.toISOString().split('T')[0];
      if (!grouped[weekKey]) {
        grouped[weekKey] = { totalSessions: 0, totalMinutes: 0 };
      }
      grouped[weekKey].totalSessions += 1;
      grouped[weekKey].totalMinutes += Math.round(s.durationSeconds / 60);
    }

    const data: { weekStart: string; totalSessions: number; totalMinutes: number }[] = [];
    for (let i = 12; i >= 0; i--) {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() - i * 7);
      const weekKey = weekStart.toISOString().split('T')[0];
      data.push({
        weekStart: weekKey,
        totalSessions: grouped[weekKey]?.totalSessions || 0,
        totalMinutes: grouped[weekKey]?.totalMinutes || 0,
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Weekly analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/heatmap', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const sessions = await prisma.session.findMany({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: oneYearAgo },
      },
      select: {
        completedAt: true,
        durationSeconds: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    const heatmap: Record<string, { date: string; count: number; minutes: number }> = {};

    for (const session of sessions) {
      const dateKey = session.completedAt.toISOString().split('T')[0];
      if (!heatmap[dateKey]) {
        heatmap[dateKey] = { date: dateKey, count: 0, minutes: 0 };
      }
      heatmap[dateKey].count += 1;
      heatmap[dateKey].minutes += Math.round(session.durationSeconds / 60);
    }

    res.json({
      success: true,
      data: {
        heatmap: Object.values(heatmap),
        startDate: oneYearAgo.toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Heatmap error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/peak-hours', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const sessions = await prisma.session.findMany({
      where: { userId, type: 'focus' },
      select: { completedAt: true, durationSeconds: true },
    });

    const hourBuckets: Record<number, { hour: number; totalSessions: number; totalMinutes: number }> = {};

    for (let i = 0; i < 24; i++) {
      hourBuckets[i] = { hour: i, totalSessions: 0, totalMinutes: 0 };
    }

    for (const session of sessions) {
      const hour = session.completedAt.getHours();
      hourBuckets[hour].totalSessions += 1;
      hourBuckets[hour].totalMinutes += Math.round(session.durationSeconds / 60);
    }

    const data = Object.values(hourBuckets).sort((a, b) => b.totalSessions - a.totalSessions);

    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Peak hours error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/comparison', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const friendIds = await getFriendIds(userId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const mySessions = await prisma.session.aggregate({
      where: {
        userId,
        type: 'focus',
        completedAt: { gte: weekAgo },
      },
      _count: { id: true },
      _sum: { durationSeconds: true },
    });

    const friendAggs = friendIds.length > 0
      ? await prisma.session.groupBy({
          by: ['userId'],
          where: {
            userId: { in: friendIds },
            type: 'focus',
            completedAt: { gte: weekAgo },
          },
          _count: { id: true },
          _sum: { durationSeconds: true },
        })
      : [];

    let friendTotalSessions = 0;
    let friendTotalSeconds = 0;
    let friendCount = 0;

    for (const fa of friendAggs) {
      if (fa._count.id > 0) {
        friendTotalSessions += fa._count.id;
        friendTotalSeconds += fa._sum.durationSeconds || 0;
        friendCount++;
      }
    }

    res.json({
      success: true,
      data: {
        me: {
          totalSessions: mySessions._count.id || 0,
          totalMinutes: mySessions._sum.durationSeconds
            ? Math.round(mySessions._sum.durationSeconds / 60)
            : 0,
        },
        friendAverage: {
          totalSessions: friendCount > 0 ? Math.round(friendTotalSessions / friendCount) : 0,
          totalMinutes: friendCount > 0
            ? Math.round(friendTotalSeconds / 60 / friendCount)
            : 0,
          friendCount,
        },
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Comparison error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

analyticsRouter.get('/analytics/summary', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const totalSessions = await prisma.session.count({
      where: { userId, type: 'focus' },
    });

    const totalSecondsAgg = await prisma.session.aggregate({
      where: { userId, type: 'focus' },
      _sum: { durationSeconds: true },
    });
    const totalHours = totalSecondsAgg._sum.durationSeconds
      ? Math.round((totalSecondsAgg._sum.durationSeconds / 3600) * 10) / 10
      : 0;

    // Streak lives on User — see the note in modules/goals/handler.ts.
    const streak = await prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true },
    });

    res.json({
      success: true,
      data: {
        totalSessions,
        totalHours,
        currentStreak: streak?.currentStreak || 0,
        longestStreak: streak?.longestStreak || 0,
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
