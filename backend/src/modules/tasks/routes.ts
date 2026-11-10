import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { resolveLocalDate } from '../../lib/localDate';
import { isScheduledOn, nextOccurrence } from '../../lib/recurrence';
import { syncGoalCompletion, userOwnsGoal } from '../../lib/goalProgress';
import { isSeriesFinished, loadRecurringState, occurrenceRow, repeatsUntil, withRecurringStats } from '../../lib/recurringStats';
import { computeTaskAnalytics, safeTimeZone } from '../../lib/taskAnalytics';
import { awardXp } from '../../lib/gamification';
import { taskCompletionXP } from '../../lib/xp';
import { eventBus, EventTypes } from '../../middleware/eventBus';
import {
  BLOCK_ORDER, firstTimedBlock, normalizeBlocks, validateTimePair, workBlockList, type NormalizedBlock,
} from '../../lib/workBlocks';

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;

const DAY_VALUES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Minutes from local midnight. 0 = 00:00, 1439 = 23:59. */
const timeOfDay = z.number().int().min(0).max(1439);

/*
 * When a task happens (docs/designs/task-due-and-work-blocks.md):
 *
 *   one-off task ──► dueDate = deadline only; planned time = its WorkBlocks
 *                    (0..N, one day each). Times on the task itself are refused.
 *   recurring task ─► dueDate = last day it repeats; startMinutes/endMinutes =
 *                    the slot each day's occurrence takes. No blocks.
 *
 * Blocks are written as one whole list with the task, replaced inside the same
 * transaction, so a save is all or nothing.
 */
const TIMES_ON_ONE_OFF = 'Times live on work blocks';
const BLOCKS_ON_HABIT = 'Work blocks are for one-off tasks';

/** Every task response carries its blocks, so the app never merges a row without them. */
const WITH_BLOCKS = { blocks: { orderBy: BLOCK_ORDER } };

function blockRows(userId: string, blocks: NormalizedBlock[]) {
  return blocks.map((b) => ({ userId, ...b }));
}

/** A non-null time sent for a task that will be one-off. Nulls (clearing) are fine. */
function sendsTime(data: { startMinutes?: number | null; endMinutes?: number | null }): boolean {
  return data.startMinutes != null || data.endMinutes != null;
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
  blocks: workBlockList.optional(),
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
  /** Present = replace all of the task's blocks with this list; absent = leave them. */
  blocks: workBlockList.optional(),
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

      if (!data.isRecurring && sendsTime(data)) {
        res.status(400).json({ success: false, error: TIMES_ON_ONE_OFF });
        return;
      }
      if (data.isRecurring && data.blocks?.length) {
        res.status(400).json({ success: false, error: BLOCKS_ON_HABIT });
        return;
      }
      const scheduleError = data.isRecurring ? validateTimePair(data.startMinutes, data.endMinutes) : null;
      if (scheduleError) {
        res.status(400).json({ success: false, error: scheduleError });
        return;
      }
      const normalized = normalizeBlocks(data.blocks ?? []);
      if ('error' in normalized) {
        res.status(400).json({ success: false, error: normalized.error });
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
          blocks: { create: blockRows(userId, normalized.blocks) },
        },
        include: WITH_BLOCKS,
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
          // Every block, not a window: a save replaces the whole list, so the
          // app must hold all of it or a save would delete what it never saw.
          include: WITH_BLOCKS,
        }),
        prisma.task.findMany({
          where: { userId, isArchived: false, isRecurring: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        }),
      ]);

      // A recurring task appears as today's row only on a day it is due. On
      // other days GET /tasks/recurring lists it with its next occurrence.
      // A completed series has no day rows: it is listed, completed, by GET /tasks/recurring.
      const dueToday = recurring.filter((t) => !t.isCompleted && isScheduledOn(t.recurringDays, today, repeatsUntil(t)));
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
        include: WITH_BLOCKS,
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

      const existing = await prisma.task.findFirst({ where: { id, userId }, include: WITH_BLOCKS });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      // A recurring task is done per DAY, in its completion log, through
      // PUT/DELETE /tasks/:id/completions/:date, which pays XP exactly once.
      // Its own isCompleted means the whole SERIES was completed
      // (docs/designs/tasks-recurring-blocks-sessions.md): allowed only once no
      // scheduled day is left, paying nothing (each day was already paid), and
      // undone by sending false. Re-sending the unchanged value, as an edit
      // form does, is harmless.
      const isRecurring = data.isRecurring ?? existing.isRecurring;
      const seriesCompletion = isRecurring
        && data.isCompleted !== undefined && data.isCompleted !== existing.isCompleted;
      if (seriesCompletion) {
        if (data.isRecurring !== undefined && data.isRecurring !== existing.isRecurring) {
          res.status(400).json({ success: false, error: 'Change the task kind and its completion separately' });
          return;
        }
        const rule = {
          recurringDays: data.recurringDays ?? existing.recurringDays,
          dueDate: data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : existing.dueDate,
        };
        if (data.isCompleted && !isSeriesFinished(rule, requestToday(req, 'PATCH /tasks/:id'))) {
          res.status(400).json({ success: false, error: 'End the series first' });
          return;
        }
      }

      // A task may only be attached to a goal the caller owns. Without this a
      // user could point their task at someone else's goal id and pollute that
      // goal's counts.
      if (data.taskGoalId !== undefined && !(await userOwnsGoal(userId, data.taskGoalId))) {
        res.status(404).json({ success: false, error: 'Goal not found' });
        return;
      }

      // Only a CHANGE of kind converts: the edit form resends isRecurring on
      // every save, and an unchanged value must not touch times or blocks.
      const toHabit = isRecurring && !existing.isRecurring;
      const toOneOff = !isRecurring && existing.isRecurring;

      if (!isRecurring && sendsTime(data)) {
        res.status(400).json({ success: false, error: TIMES_ON_ONE_OFF });
        return;
      }
      if (isRecurring && data.blocks?.length) {
        res.status(400).json({ success: false, error: BLOCKS_ON_HABIT });
        return;
      }
      const normalized = normalizeBlocks(data.blocks ?? []);
      if ('error' in normalized) {
        res.status(400).json({ success: false, error: normalized.error });
        return;
      }

      // A habit's own time. Becoming one, a time sent with the request wins,
      // else the earliest timed block's. Validated against the MERGED row, so a
      // PATCH clearing only one end cannot leave half a time.
      let habitStart: number | null = null;
      let habitEnd: number | null = null;
      if (isRecurring) {
        const fromBlock = toHabit ? firstTimedBlock(existing.blocks) : null;
        const base = toHabit
          ? { start: fromBlock?.startMinutes ?? null, end: fromBlock?.endMinutes ?? null }
          : { start: existing.startMinutes, end: existing.endMinutes };
        habitStart = data.startMinutes !== undefined ? data.startMinutes : base.start;
        habitEnd = data.endMinutes !== undefined ? data.endMinutes : base.end;
        const scheduleError = validateTimePair(habitStart, habitEnd);
        if (scheduleError) {
          res.status(400).json({ success: false, error: scheduleError });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
      if (isRecurring) {
        updateData.startMinutes = habitStart;
        updateData.endMinutes = habitEnd;
      } else if (toOneOff) {
        // The habit's slot does not carry over; the form sends a block for it.
        updateData.startMinutes = null;
        updateData.endMinutes = null;
      }
      if (data.priority !== undefined) updateData.priority = data.priority;
      if (data.isCompleted !== undefined) updateData.isCompleted = data.isCompleted;
      if (data.completedAt !== undefined) updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;
      // A series completion is stamped here when the app sends no time, so the
      // Completed list can order it with everything else.
      if (seriesCompletion && data.completedAt === undefined) updateData.completedAt = data.isCompleted ? new Date() : null;
      if (data.taskGoalId  !== undefined) updateData.taskGoalId  = data.taskGoalId ?? null;
      if (data.order       !== undefined) updateData.order       = data.order ?? null;
      if (data.isRecurring   !== undefined) updateData.isRecurring   = data.isRecurring;
      if (data.recurringDays !== undefined) updateData.recurringDays = data.recurringDays;

      // Becoming a habit drops every block (design D14); otherwise a sent list
      // replaces the old one. Same transaction as the task, so all or nothing.
      const replaceBlocks = toHabit || (!isRecurring && data.blocks !== undefined);
      const task = await prisma.$transaction(async (tx) => {
        if (replaceBlocks) {
          await tx.workBlock.deleteMany({ where: { taskId: id } });
          if (!toHabit && normalized.blocks.length) {
            await tx.workBlock.createMany({ data: blockRows(userId, normalized.blocks).map((b) => ({ ...b, taskId: id })) });
          }
        }
        return tx.task.update({ where: { id }, data: updateData, include: WITH_BLOCKS });
      });

      // ── Gamification on completion ──
      // Finishing work now earns XP, not just spending time on it. Un-checking
      // revokes exactly what completing granted, so the pair is a true undo and
      // toggling can't farm XP.
      let reward = null;
      // A series completion pays nothing: every day was paid when it was ticked.
      const completionChanged = !seriesCompletion
        && data.isCompleted !== undefined && existing.isCompleted !== data.isCompleted;

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
