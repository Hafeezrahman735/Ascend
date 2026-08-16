import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { resolveLocalDate, dayNameFromLocalDate } from '../../lib/localDate';
import { syncGoalCompletion, userOwnsGoal } from '../../lib/goalProgress';
import { awardXp } from '../../lib/gamification';
import { taskCompletionXP } from '../../lib/xp';
import { eventBus, EventTypes } from '../../middleware/eventBus';

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
const DAY_VALUES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

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
  // Was missing entirely, so a goal picked in the create form was silently
  // dropped by zod and the user had to create-then-edit to attach it.
  taskGoalId: z.string().nullable().optional(),
  // The client's calendar day, so a recurring task spawns on the user's "today"
  // rather than the server's. See lib/localDate.ts.
  localDate: z.string().optional().nullable(),
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

      // Same ownership gate as the update path — a task may only be attached to
      // a goal the caller owns.
      if (!(await userOwnsGoal(userId, data.taskGoalId))) {
        res.status(404).json({ success: false, error: 'Goal not found' });
        return;
      }

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
          taskGoalId: data.taskGoalId ?? null,
        },
      });

      // If recurring, spawn today's instance immediately so it shows up right away.
      if (data.isRecurring) {
        const today = resolveLocalDate(data.localDate, new Date(), 'POST /tasks');
        const todayDayName = dayNameFromLocalDate(today);
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
              // Instances inherit the template's goal link. Templates are hidden
              // from GET /tasks, so without this a recurring task linked to a
              // goal contributed nothing to it — ever.
              taskGoalId: data.taskGoalId ?? null,
              sessionsOnTask: 0,
              totalTimeOnTask: 0,
              sessionDates: [],
              // Brand-new habit — no lifetime history yet.
              lifetimeStreak: 0,
              lifetimeTotalCompletions: 0,
              lifetimeTotalFocusTime: 0,
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
      // "Today" is the CLIENT's calendar day. Using the server's UTC date here
      // ended the day early for anyone west of UTC: their in-progress habit was
      // archived as missed and the streak reset while it was still that evening.
      const { localDate } = z
        .object({ localDate: z.string().optional().nullable() })
        .parse(req.body ?? {});
      const today = resolveLocalDate(localDate, new Date(), 'POST /tasks/spawn-recurring');
      const todayDayName = dayNameFromLocalDate(today);
      const { start: todayStart, end: todayEnd } = dayBounds(today);

      const templates = await prisma.task.findMany({
        where: {
          userId,
          isRecurring: true,
          isArchived: false,
          NOT: { lastSpawnedDate: today },
        },
      });

      const spawned: string[] = [];
      let archived = 0;

      for (const template of templates) {
        // ── 1. Archive ALL previous instances of this template that aren't today's ──
        // Covers completed AND uncompleted — only today's instance should ever be
        // visible in the active list. This is what prevents pileup of missed days
        // and stops a not-completed instance from lingering as "overdue" the next day.
        const staleInstances = await prisma.task.findMany({
          where: {
            userId,
            parentTaskId: template.id,
            isArchived: false,
            NOT: { dueDate: { gte: todayStart, lt: todayEnd } },
          },
          select: { id: true },
        });
        if (staleInstances.length > 0) {
          await prisma.task.updateMany({
            where: { id: { in: staleInstances.map((t) => t.id) } },
            data: { isArchived: true },
          });
          archived += staleInstances.length;
        }

        // ── 2. Immediate streak reset if the last spawned instance was missed ──
        let effectiveStreak = template.currentStreak;
        if (template.lastSpawnedDate && template.lastSpawnedDate !== today) {
          const { start: lastStart, end: lastEnd } = dayBounds(template.lastSpawnedDate);
          // Query includes archived instances on purpose: a prior spawn run (e.g. an
          // in-between non-scheduled day) may already have archived the last instance,
          // so we must look it up directly rather than rely on `staleInstances`.
          const lastInstance = await prisma.task.findFirst({
            where: {
              userId,
              parentTaskId: template.id,
              dueDate: { gte: lastStart, lt: lastEnd },
            },
          });
          const wasMissed = !lastInstance || !lastInstance.isCompleted;

          if (wasMissed && template.currentStreak !== 0) {
            await prisma.task.update({
              where: { id: template.id },
              data: { currentStreak: 0 },
            });
            effectiveStreak = 0;
          }
        }

        // ── 3. Spawn today's instance if scheduled ──
        const shouldSpawn =
          template.recurringDays.length === 0 ||
          template.recurringDays.includes(todayDayName);
        if (!shouldSpawn) continue;

        // Safety check — never create a duplicate instance for today.
        const existing = await prisma.task.findFirst({
          where: {
            userId,
            parentTaskId: template.id,
            dueDate: { gte: todayStart, lt: todayEnd },
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
            // Carry the template's goal link onto each spawned instance — the
            // template itself is excluded from GET /tasks, so the instance is
            // the only thing that can count toward the goal.
            taskGoalId: template.taskGoalId,
            sessionsOnTask: 0,
            totalTimeOnTask: 0,
            sessionDates: [],
            // Denormalized lifetime stats — copied for instant display in the stats
            // modal, so it needs no extra network round trip.
            lifetimeStreak: effectiveStreak,
            lifetimeTotalCompletions: template.totalCompletions,
            lifetimeTotalFocusTime: template.totalFocusTimeMs,
          },
        });

        await prisma.task.update({
          where: { id: template.id },
          data: { lastSpawnedDate: today },
        });

        spawned.push(template.id);
      }

      res.json({ success: true, data: { spawned: spawned.length, archived, templateIds: spawned } });
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

      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const dayOfWeekNow = now.getUTCDay();
      const mondayOffsetNow = dayOfWeekNow === 0 ? -6 : 1 - dayOfWeekNow;
      const startOfWeekNow = new Date(startOfDay);
      startOfWeekNow.setUTCDate(startOfWeekNow.getUTCDate() + mondayOffsetNow);
      const startOfMonthNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      // Always read the full history. There used to be a `period` query param that
      // filtered this query, which meant ?period=today returned today's total
      // under the key `totalTimeAllTime` and skewed estimationAccuracy with it.
      // The today/week/month buckets below are derived by comparing timestamps, so
      // one unfiltered read gives every bucket the correct value.
      const sessions = await prisma.session.findMany({
        where: {
          taskId: id,
          userId,
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

        // A session counts as completed if it ran at least 90% of its planned
        // length, or had no planned length to fall short of. The three-branch
        // version also tracked a `totalSkipped` counter that was never read.
        const ranFullLength =
          !s.plannedDurationSeconds || s.durationSeconds >= s.plannedDurationSeconds * 0.9;
        if (ranFullLength) totalCompleted++;
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

      // A task may only be attached to a goal the caller owns. Without this a
      // user could point their task at someone else's goal id and pollute that
      // goal's counts.
      if (data.taskGoalId !== undefined && !(await userOwnsGoal(userId, data.taskGoalId))) {
        res.status(404).json({ success: false, error: 'Goal not found' });
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

      // Recurring habit stats: roll into the parent template on completion toggles.
      // Streak *resetting* on a missed day now happens entirely in spawn-recurring —
      // this block only increments on completion or undoes today's increment on
      // uncomplete, and never looks backward at previous days. Guarded on an actual
      // completion-state change so repeated/unrelated PATCHes don't double-count.
      if (
        task.parentTaskId &&
        data.isCompleted !== undefined &&
        existing.isCompleted !== data.isCompleted
      ) {
        const template = await prisma.task.findUnique({ where: { id: task.parentTaskId } });
        if (template) {
          if (data.isCompleted === true) {
            const newStreak = template.currentStreak + 1;
            await prisma.task.update({
              where: { id: template.id },
              data: {
                currentStreak: newStreak,
                longestStreak: Math.max(template.longestStreak, newStreak),
                totalCompletions: template.totalCompletions + 1,
                totalFocusTimeMs: template.totalFocusTimeMs + (task.totalTimeOnTask ?? 0),
              },
            });
          } else {
            // Uncompleting is a full undo of the completion above. It previously
            // rolled back only the streak and left totalCompletions /
            // totalFocusTimeMs untouched, so toggling complete → incomplete →
            // complete inflated the lifetime counters without bound.
            await prisma.task.update({
              where: { id: template.id },
              data: {
                currentStreak: Math.max(0, template.currentStreak - 1),
                totalCompletions: Math.max(0, template.totalCompletions - 1),
                totalFocusTimeMs: Math.max(0, template.totalFocusTimeMs - (task.totalTimeOnTask ?? 0)),
              },
            });
          }
        }
      }

      // ── Gamification on completion ──
      // Finishing work now earns XP, not just spending time on it. Un-checking
      // revokes exactly what completing granted, so the pair is a true undo and
      // toggling can't farm XP.
      let reward = null;
      const completionChanged =
        data.isCompleted !== undefined && existing.isCompleted !== data.isCompleted;

      if (completionChanged) {
        const xp = taskCompletionXP(task.priority);
        const isNowComplete = data.isCompleted === true;

        reward = await awardXp(userId, isNowComplete ? xp : -xp, {
          tasksCompletedDelta: isNowComplete ? 1 : -1,
        });

        if (isNowComplete) {
          eventBus.emit(EventTypes.FEED_CREATE, {
            userId,
            eventType: 'task_completed',
            payload: { taskTitle: task.title, priority: task.priority, xpEarned: xp },
          });
        }
      }

      // Anything that changed completion or moved the task between goals can move
      // goal progress. Recompute both the old and new goal so a task leaving a
      // goal updates that goal too.
      if (data.isCompleted !== undefined || data.taskGoalId !== undefined) {
        await syncGoalCompletion(
          userId,
          [existing.taskGoalId, task.taskGoalId].filter((g): g is string => !!g),
        );
      }

      res.json({ success: true, data: task, reward });
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
        // Atomic decrement. Read-then-write lost updates when a session completed
        // (which increments these same columns) between the read and the write.
        await prisma.user.update({
          where: { id: userId },
          data: {
            totalFocusTime: { decrement: removedSeconds },
            totalSessions: { decrement: removedCount },
          },
        });
        // The old code clamped at zero; `decrement` cannot, so restore the floor
        // in a follow-up that only touches rows which actually went negative.
        await prisma.user.updateMany({
          where: { id: userId, totalFocusTime: { lt: 0 } },
          data: { totalFocusTime: 0 },
        });
        await prisma.user.updateMany({
          where: { id: userId, totalSessions: { lt: 0 } },
          data: { totalSessions: 0 },
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
