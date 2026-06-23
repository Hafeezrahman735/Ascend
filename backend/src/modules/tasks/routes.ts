import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
const DAY_VALUES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Maps a Date to its lowercase 3-letter weekday name (matches recurringDays values).
function getDayName(date: Date): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}

// Returns the [start, end) UTC-day bounds for an ISO date string 'YYYY-MM-DD'.
function dayBounds(isoDate: string): { start: Date; end: Date } {
  const start = new Date(`${isoDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

const createTaskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional().default([]),
  estimatedMinutes: z.number().int().min(1).optional().nullable(),
  priority: z.enum(PRIORITY_VALUES).optional().default('medium'),
  isRecurring: z.boolean().optional().default(false),
  recurringDays: z.array(z.enum(DAY_VALUES)).max(7).optional().default([]),
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
  taskGoalId: z.string().optional().nullable(),
  order: z.number().int().optional().nullable(),
  isRecurring: z.boolean().optional(),
  recurringDays: z.array(z.enum(DAY_VALUES)).max(7).optional(),
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
          isRecurring: data.isRecurring,
          recurringDays: data.recurringDays,
        },
      });

      // If recurring, spawn today's instance immediately so it shows up right away.
      if (data.isRecurring) {
        const today = new Date().toISOString().split('T')[0];
        const todayDayName = getDayName(new Date());
        const shouldSpawnToday =
          data.recurringDays.length === 0 || data.recurringDays.includes(todayDayName as typeof DAY_VALUES[number]);

        if (shouldSpawnToday) {
          await prisma.task.create({
            data: {
              userId,
              title: data.title,
              description: data.description || null,
              tags: data.tags,
              estimatedMinutes: data.estimatedMinutes || null,
              priority: data.priority,
              dueDate: new Date(today),
              parentTaskId: task.id,
              isRecurring: false, // instances are not themselves recurring
              recurringDays: [],
            },
          });

          await prisma.task.update({
            where: { id: task.id },
            data: { lastSpawnedDate: today },
          });
        }
      }

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
        // Exclude recurring templates — they are definitions, not actionable tasks.
        where: { userId, isArchived: false, isRecurring: false },
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      });

      res.json({ success: true, data: tasks });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('List tasks error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Returns all recurring templates for the current user (manage/edit screen).
  // Registered before '/tasks/:id' so 'recurring' is not captured as an id.
  router.get('/tasks/recurring', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const templates = await prisma.task.findMany({
        where: { userId, isRecurring: true, isArchived: false },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: templates });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('List recurring templates error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Spawns today's instances for all recurring templates not yet spawned today.
  // Called on app boot, task screen mount, and foreground. Idempotent.
  router.post('/tasks/spawn-recurring', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const today = new Date().toISOString().split('T')[0];
      const todayDayName = getDayName(new Date());

      const templates = await prisma.task.findMany({
        where: {
          userId,
          isRecurring: true,
          isArchived: false,
          isCompleted: false,
          NOT: { lastSpawnedDate: today },
        },
      });

      const { start, end } = dayBounds(today);
      const spawned: string[] = [];

      for (const template of templates) {
        const shouldSpawn =
          template.recurringDays.length === 0 ||
          template.recurringDays.includes(todayDayName);
        if (!shouldSpawn) continue;

        // Safety check — never create a duplicate instance for today.
        const existing = await prisma.task.findFirst({
          where: {
            userId,
            parentTaskId: template.id,
            dueDate: { gte: start, lt: end },
          },
        });
        if (existing) {
          await prisma.task.update({
            where: { id: template.id },
            data: { lastSpawnedDate: today },
          });
          continue;
        }

        await prisma.task.create({
          data: {
            userId,
            title: template.title,
            description: template.description,
            tags: template.tags,
            estimatedMinutes: template.estimatedMinutes,
            priority: template.priority,
            dueDate: new Date(today),
            parentTaskId: template.id,
            isRecurring: false,
            recurringDays: [],
          },
        });

        await prisma.task.update({
          where: { id: template.id },
          data: { lastSpawnedDate: today },
        });

        spawned.push(template.id);
      }

      res.json({ success: true, data: { spawned: spawned.length, templateIds: spawned } });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Spawn recurring error:', err);
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

      const period = (req.query.period as string | undefined) ?? 'all';
      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const dayOfWeekNow = now.getUTCDay();
      const mondayOffsetNow = dayOfWeekNow === 0 ? -6 : 1 - dayOfWeekNow;
      const startOfWeekNow = new Date(startOfDay);
      startOfWeekNow.setUTCDate(startOfWeekNow.getUTCDate() + mondayOffsetNow);
      const startOfMonthNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const periodFilter: Record<string, Date | undefined> = {
        today: startOfDay,
        week:  startOfWeekNow,
        month: startOfMonthNow,
      };
      const periodStart = periodFilter[period];

      const sessions = await prisma.session.findMany({
        where: {
          taskId: id,
          userId,
          ...(periodStart ? { completedAt: { gte: periodStart } } : {}),
        },
        select: {
          durationSeconds: true,
          plannedDurationSeconds: true,
          completedAt: true,
        },
      });
      const startOfWeek = startOfWeekNow;
      const startOfMonth = startOfMonthNow;

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
      if (data.taskGoalId  !== undefined) updateData.taskGoalId  = data.taskGoalId ?? null;
      if (data.order       !== undefined) updateData.order       = data.order ?? null;
      if (data.isRecurring   !== undefined) updateData.isRecurring   = data.isRecurring;
      if (data.recurringDays !== undefined) updateData.recurringDays = data.recurringDays;

      const task = await prisma.task.update({
        where: { id },
        data: updateData,
      });

      // Recurring streak: lives on the template, driven by instance completion.
      if (task.parentTaskId && data.isCompleted === true) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const { start, end } = dayBounds(yesterdayStr);

        const template = await prisma.task.findUnique({ where: { id: task.parentTaskId } });
        if (template) {
          // Did yesterday's instance get completed? If so the streak continues.
          const yesterdayInstance = await prisma.task.findFirst({
            where: {
              parentTaskId: template.id,
              isCompleted: true,
              dueDate: { gte: start, lt: end },
            },
          });
          const newStreak = yesterdayInstance ? template.recurringStreak + 1 : 1;
          await prisma.task.update({
            where: { id: template.id },
            data: { recurringStreak: newStreak },
          });
        }
      } else if (task.parentTaskId && data.isCompleted === false) {
        // Uncompleting breaks the streak — reset the template to 0.
        await prisma.task.update({
          where: { id: task.parentTaskId },
          data: { recurringStreak: 0 },
        });
      }

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

      // Remove this task's focus-session stats from the user's all-time totals,
      // then delete the sessions so they leave the time tracker and analytics.
      const agg = await prisma.session.aggregate({
        where: { taskId: id, userId, type: 'focus' },
        _sum: { durationSeconds: true },
        _count: true,
      });
      const removedSeconds = agg._sum.durationSeconds ?? 0;
      const removedCount = agg._count ?? 0;

      await prisma.session.deleteMany({ where: { taskId: id, userId } });

      if (removedSeconds > 0 || removedCount > 0) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { totalFocusTime: true, totalSessions: true },
        });
        await prisma.user.update({
          where: { id: userId },
          data: {
            totalFocusTime: Math.max(0, (user?.totalFocusTime ?? 0) - removedSeconds),
            totalSessions: Math.max(0, (user?.totalSessions ?? 0) - removedCount),
          },
        });
      }

      await prisma.task.update({
        where: { id },
        data: { isArchived: true },
      });

      res.json({ success: true, data: { removedSeconds, removedCount } });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Delete task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}
