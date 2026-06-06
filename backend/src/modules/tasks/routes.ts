import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;

const createTaskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional().default([]),
  estimatedMinutes: z.number().int().min(1).optional().nullable(),
  priority: z.enum(PRIORITY_VALUES).optional().default('medium'),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  estimatedMinutes: z.number().int().min(1).optional().nullable(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  isCompleted: z.boolean().optional(),
  completedAt: z.string().optional().nullable(),
});

export function setupTaskRoutes(router: Router): void {

  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const data = createTaskSchema.parse(req.body);

      const task = await prisma.task.create({
        data: {
          userId,
          title: data.title,
          description: data.description || null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          tags: data.tags,
          estimatedMinutes: data.estimatedMinutes || null,
          priority: data.priority,
        },
      });

      res.json({ success: true, data: task });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Create task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.get('/tasks', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);

      const tasks = await prisma.task.findMany({
        where: { userId, isArchived: false },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: tasks });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('List tasks error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { id } = req.params;

      const task = await prisma.task.findFirst({
        where: { id, userId },
      });

      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      const sessions = await prisma.session.findMany({
        where: { taskId: id, userId },
        select: {
          durationSeconds: true,
          plannedDurationSeconds: true,
          completedAt: true,
        },
      });

      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() + mondayOffset);
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const last7Days: { date: string; seconds: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(startOfDay);
        d.setUTCDate(d.getUTCDate() - i);
        last7Days.push({
          date: d.toISOString().split('T')[0],
          seconds: 0,
        });
      }

      let totalTimeToday = 0;
      let totalTimeThisWeek = 0;
      let totalTimeThisMonth = 0;
      let totalTimeAllTime = 0;
      let totalCompleted = 0;
      let totalSkipped = 0;
      const hourCounts: Record<number, number> = {};

      for (const s of sessions) {
        totalTimeAllTime += s.durationSeconds;

        const ca = new Date(s.completedAt);
        const dateKey = ca.toISOString().split('T')[0];

        if (ca >= startOfDay) totalTimeToday += s.durationSeconds;
        if (ca >= startOfWeek) totalTimeThisWeek += s.durationSeconds;
        if (ca >= startOfMonth) totalTimeThisMonth += s.durationSeconds;

        for (const d of last7Days) {
          if (d.date === dateKey) {
            d.seconds += s.durationSeconds;
            break;
          }
        }

        const hour = ca.getUTCHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + s.durationSeconds;

        if (s.plannedDurationSeconds && s.durationSeconds >= s.plannedDurationSeconds * 0.9) {
          totalCompleted++;
        } else if (s.plannedDurationSeconds) {
          totalSkipped++;
        } else {
          totalCompleted++;
        }
      }

      let mostProductiveHour: { hour: number; label: string } | null = null;
      let maxHourSeconds = 0;
      for (const h of Object.keys(hourCounts)) {
        const hour = Number(h);
        if (hourCounts[hour] > maxHourSeconds) {
          maxHourSeconds = hourCounts[hour];
          const period = hour >= 12 ? 'pm' : 'am';
          const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          mostProductiveHour = { hour, label: `${display}${period}` };
        }
      }

      const totalSessions = sessions.length;
      const avgSessionLength = totalSessions > 0 ? Math.round(totalTimeAllTime / totalSessions) : 0;
      const completionRate = totalSessions > 0 ? Math.round((totalCompleted / totalSessions) * 100) : 0;

      let estimationAccuracy: number | null = null;
      if (task.estimatedMinutes && task.estimatedMinutes > 0) {
        const totalMinutes = totalTimeAllTime / 60;
        estimationAccuracy = Math.round((totalMinutes / task.estimatedMinutes) * 100);
      }

      res.json({
        success: true,
        data: {
          ...task,
          analytics: {
            totalTimeToday,
            totalTimeThisWeek,
            totalTimeThisMonth,
            totalTimeAllTime,
            timePerDayLast7: last7Days,
            mostProductiveHour,
            avgSessionLength,
            completionRate,
            estimationAccuracy,
          },
        },
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Get task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.patch('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { id } = req.params;
      const data = updateTaskSchema.parse(req.body);

      const existing = await prisma.task.findFirst({ where: { id, userId } });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
      if (data.priority !== undefined) updateData.priority = data.priority;
      if (data.isCompleted !== undefined) updateData.isCompleted = data.isCompleted;
      if (data.completedAt !== undefined) updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;

      const task = await prisma.task.update({
        where: { id },
        data: updateData,
      });

      res.json({ success: true, data: task });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (handleAuthError(res, err)) return;
      console.error('Update task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  router.delete('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const { id } = req.params;

      const existing = await prisma.task.findFirst({ where: { id, userId } });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      await prisma.task.update({
        where: { id },
        data: { isArchived: true },
      });

      res.json({ success: true, data: null });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Delete task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}
