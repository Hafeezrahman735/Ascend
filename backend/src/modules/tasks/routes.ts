import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { resolveLocalDate } from '../../lib/localDate';
import { isScheduledOn, nextOccurrence } from '../../lib/recurrence';
import { syncGoalCompletion, userOwnsGoal } from '../../lib/goalProgress';
import { loadRecurringState, occurrenceRow, repeatsUntil, withRecurringStats } from '../../lib/recurringStats';
import { computeTaskAnalytics, safeTimeZone } from '../../lib/taskAnalytics';
import { awardXp } from '../../lib/gamification';
import { taskCompletionXP } from '../../lib/xp';
import { eventBus, EventTypes } from '../../middleware/eventBus';

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;

const DAY_VALUES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Minutes from local midnight. 0 = 00:00, 1439 = 23:59. */
const timeOfDay = z.number().int().min(0).max(1439);

/**
 * Validates a task’s scheduled time-of-day pair. Returns an error message, or
 * null when the pair is valid.
 *
 * Three rules, each for a reason:
 *  - a time needs a day   — 09:00 with no dueDate cannot be placed anywhere
 *  - both ends or neither — the timeline draws blocks, and a block needs a height
 *  - end after start      — a zero or negative interval has nothing to draw
 *
 * Recurring tasks are exempt from the first rule: their dueDate is the last day
 * they repeat, not the day they happen. Each day's occurrence row takes the
 * time slot on its own day (lib/recurringStats.ts).
 */
function validateSchedule(
  startMinutes: number | null | undefined,
  endMinutes: number | null | undefined,
  dueDate: Date | null,
  isRecurringTemplate = false,
): string | null {
  const start = startMinutes ?? null;
  const end = endMinutes ?? null;
  if (start === null && end === null) return null;
  if (!dueDate && !isRecurringTemplate) return 'A scheduled time needs a due date';
  if (start === null || end === null) return 'A scheduled task needs both a start and an end time';
  if (end <= start) return 'End time must be after start time';
  return null;
}

const createTaskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional().default([]),
  estimatedMinutes: z.number().int().min(1).optional().nullable(),
  // Minutes from local midnight. Both or neither — see validateSchedule.
  startMinutes: timeOfDay.optional().nullable(),
  endMinutes: timeOfDay.optional().nullable(),
  priority: z.enum(PRIORITY_VALUES).optional().default('medium'),
  isRecurring: z.boolean().optional().default(false),
  recurringDays: z.array(z.enum(DAY_VALUES)).max(7).optional().default([]),
  // Was missing entirely, so a goal picked in the create form was silently
  // dropped by zod and the user had to create-then-edit to attach it.
  taskGoalId: z.string().nullable().optional(),
});

/**
 * The caller's local today, from `?localDate=` (or the body's `localDate`),
 * falling back to the UTC day. See lib/localDate.ts.
 */
function requestToday(req: Request, context: string): string {
  const fromQuery = typeof req.query.localDate === 'string' ? req.query.localDate : undefined;
  const fromBody = typeof req.body?.localDate === 'string' ? req.body.localDate : undefined;
  return resolveLocalDate(fromQuery ?? fromBody, new Date(), context);
}

const updateTaskSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  estimatedMinutes: z.number().int().min(1).optional().nullable(),
  // Minutes from local midnight. Both or neither — see validateSchedule.
  startMinutes: timeOfDay.optional().nullable(),
  endMinutes: timeOfDay.optional().nullable(),
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

      const scheduleError = validateSchedule(
        data.startMinutes,
        data.endMinutes,
        data.dueDate ? new Date(data.dueDate) : null,
        data.isRecurring,
      );
      if (scheduleError) {
        res.status(400).json({ success: false, error: scheduleError });
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
          startMinutes: data.startMinutes ?? null,
          endMinutes: data.endMinutes ?? null,
          priority: data.priority,
          isRecurring: data.isRecurring,
          recurringDays: data.recurringDays,
          taskGoalId: data.taskGoalId ?? null,
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

      const today = requestToday(req, 'GET /tasks');

      const [tasks, recurring] = await Promise.all([
        prisma.task.findMany({
          where: { userId, isArchived: false, isRecurring: false },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        }),
        prisma.task.findMany({
          where: { userId, isArchived: false, isRecurring: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        }),
      ]);

      // A recurring task appears as today's row only on a day it is due. On
      // other days GET /tasks/recurring lists it with its next occurrence.
      const dueToday = recurring.filter((t) => isScheduledOn(t.recurringDays, today, repeatsUntil(t)));
      const state = await loadRecurringState(userId, dueToday, today);
      const todayRows = dueToday.map((t) => occurrenceRow(t, state.get(t.id)!, today));

      res.json({ success: true, data: [...tasks, ...todayRows] });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('List tasks error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Returns every live recurring task with its schedule and streaks.
  // Registered before '/tasks/:id' so 'recurring' is not captured as an id.
  router.get('/tasks/recurring', async (req: Request, res: Response) => {
    try {
      const userId = authenticate(req);
      const tasks = await prisma.task.findMany({
        where: { userId, isRecurring: true, isArchived: false },
        orderBy: { createdAt: 'desc' },
      });

      // The schedule is answered here, not inferred on the client: scheduling
      // is a property of the task, so the server states it. Past the task's
      // last day it is neither scheduled today nor ever again, and the client
      // renders that as "no longer repeats" rather than a stale next date.
      const today = requestToday(req, 'GET /tasks/recurring');
      const state = await loadRecurringState(userId, tasks, today);

      res.json({
        success: true,
        data: tasks.map((t) => ({
          ...withRecurringStats(t, state.get(t.id)!, today),
          nextOccurrence: nextOccurrence(t.recurringDays, today, repeatsUntil(t)),
        })),
      });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('List recurring tasks error:', err);
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

      const timeZone = safeTimeZone(
        typeof req.query.tz === 'string' ? req.query.tz : undefined,
      );

      // Always read the full history. There used to be a `period` query param
      // that filtered this query, which meant ?period=today returned today's
      // total under the key `totalTimeAllTime` and skewed the estimate figures
      // with it. Every bucket is derived from timestamps inside
      // computeTaskAnalytics, so one unfiltered read feeds them all correctly.
      //
      // `type: 'focus'` matches loadGoalCounts and DELETE /tasks/:id, which both
      // filter on it. Every session the timer writes today is 'focus', so this
      // changes no current number — it stops a future break row that carries a
      // taskId from silently inflating focus totals.
      const sessions = await prisma.session.findMany({
        where: { taskId: id, userId, type: 'focus' },
        select: {
          durationSeconds: true,
          plannedDurationSeconds: true,
          completedAt: true,
        },
      });

      const analytics = computeTaskAnalytics({
        sessions,
        estimatedMinutes: task.estimatedMinutes,
        createdAt: task.createdAt,
        now: new Date(),
        timeZone,
      });

      if (!task.isRecurring) {
        res.json({ success: true, data: { ...task, analytics } });
        return;
      }
      const today = requestToday(req, 'GET /tasks/:id');
      const state = await loadRecurringState(userId, [task], today);
      res.json({ success: true, data: { ...withRecurringStats(task, state.get(task.id)!, today), analytics } });
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

      // A recurring task is done per DAY, in its completion log; the row's own
      // isCompleted means nothing for it. Ticking one goes through
      // PUT/DELETE /tasks/:id/completions/:date, which pays XP exactly once.
      // Re-sending the unchanged value, as an edit form does, is harmless.
      const isRecurring = data.isRecurring ?? existing.isRecurring;
      if (isRecurring && data.isCompleted !== undefined && data.isCompleted !== existing.isCompleted) {
        res.status(400).json({
          success: false,
          error: 'Tick off a recurring task with PUT /tasks/:id/completions/:date',
        });
        return;
      }

      // A task may only be attached to a goal the caller owns. Without this a
      // user could point their task at someone else's goal id and pollute that
      // goal's counts.
      if (data.taskGoalId !== undefined && !(await userOwnsGoal(userId, data.taskGoalId))) {
        res.status(404).json({ success: false, error: 'Goal not found' });
        return;
      }

      // Validated against the MERGED row rather than the patch alone: a PATCH
      // that only clears dueDate would otherwise leave a 09:00-10:00 task
      // floating on no day, and one that clears only startMinutes would leave a
      // block with an end but no beginning.
      const scheduleError = validateSchedule(
        data.startMinutes !== undefined ? data.startMinutes : existing.startMinutes,
        data.endMinutes !== undefined ? data.endMinutes : existing.endMinutes,
        data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : existing.dueDate,
        data.isRecurring !== undefined ? data.isRecurring : existing.isRecurring,
      );
      if (scheduleError) {
        res.status(400).json({ success: false, error: scheduleError });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
      if (data.startMinutes !== undefined) updateData.startMinutes = data.startMinutes ?? null;
      if (data.endMinutes   !== undefined) updateData.endMinutes   = data.endMinutes ?? null;
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
          { today: requestToday(req, 'PATCH /tasks/:id') },
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

      // Deleting a task archives it and keeps its focus sessions. It used to
      // delete them and subtract them from the all-time totals, so one tap
      // erased hours of real history from the time tracker, the leaderboard
      // and the profile — while deleting a habit already kept its sessions.
      // Focus time is a record of what happened, not a property of the task
      // (product decision, 2026-10-22). Sessions keep the task's title and
      // tags as they were stamped when logged, so reports still label them.
      await prisma.task.update({
        where: { id },
        data: { isArchived: true },
      });

      res.json({ success: true, data: { id } });
    } catch (err) {
      if (handleAuthError(res, err)) return;
      console.error('Delete task error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
}
