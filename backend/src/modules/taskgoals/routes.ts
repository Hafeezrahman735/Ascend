import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import {
  computeProgress, loadGoalCounts, syncGoalCompletion, userOwnsTasks,
} from '../../lib/goalProgress';

export const taskGoalsRouter = Router();

const PROGRESS_MODES = ['tasks', 'sessions', 'both'] as const;

/** Nothing is linked yet, or the goal has no rows to count. */
const NO_COUNTS = {
  linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0, totalFocusSeconds: 0,
};

/**
 * A goal is measured on its completed tasks, so the only thing the client sends
 * about "how much" is which tasks belong to it.
 *
 * `targetSessions` and `progressMode` are RETIRED but still accepted, stored and
 * ignored. They must not be rejected: this is a mobile app that cannot be
 * force-updated, so an older binary on someone's phone keeps sending them
 * indefinitely and a 400 would leave that person permanently unable to save a
 * goal. They can be rejected only once no shipped build sends them, which is the
 * same conversation as dropping the column.
 */
const TASK_IDS = z.array(z.string().min(1)).max(200);

// A deadline is a calendar day, not an instant — accepted and returned as
// 'YYYY-MM-DD' and stored in a @db.Date column. The old code parsed
// `deadline + 'T00:00:00'` in the creating device's timezone and stored the
// resulting instant, so the same goal read as a different day depending on where
// you opened it.
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const deadlineSchema = z
  .string()
  .regex(YYYY_MM_DD, 'deadline must be a YYYY-MM-DD date')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), 'deadline is not a real date');

/** Parse a 'YYYY-MM-DD' deadline into the UTC-midnight Date a @db.Date column stores. */
function parseDeadline(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** Render a @db.Date back as the plain calendar day the client sent. */
function formatDeadline(value: Date | null): string | null {
  if (!value) return null;
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const createSchema = z.object({
  title:          z.string().min(1).max(80),
  tag:            z.string().max(30).optional().nullable(),
  deadline:       deadlineSchema.optional().nullable(),
  /** Linked in the same transaction as the create — see the handler. */
  taskIds:        TASK_IDS.optional(),
  // Retired, accepted, ignored. See TASK_IDS above.
  targetSessions: z.number().int().positive().max(200).optional().nullable(),
  progressMode:   z.enum(PROGRESS_MODES).optional(),
});

/** Add and remove links in one call. Deltas, never a replacement set. */
const linkSchema = z.object({
  link:   TASK_IDS.optional(),
  unlink: TASK_IDS.optional(),
});

const updateSchema = z.object({
  title:          z.string().min(1).max(80).optional(),
  tag:            z.string().max(30).optional().nullable(),
  targetSessions: z.number().int().positive().max(200).optional().nullable(),
  deadline:       deadlineSchema.optional().nullable(),
  progressMode:   z.enum(PROGRESS_MODES).optional(),
  isCompleted:    z.boolean().optional(),
  completedAt:    z.string().datetime({ offset: true }).optional().nullable(),
});

/**
 * Exactly what a goal looks like on the wire.
 *
 * Stated as a type rather than left to inference because the mobile `TaskGoal`
 * interface is hand-maintained against it with no runtime validation on either
 * side. That gap is not hypothetical: `totalFocusSeconds` and `elapsedDays`
 * were served here and silently dropped by the client for months, because
 * nothing anywhere compares the two shapes. An explicit type plus the key-set
 * assertion in `stats.integration.test.ts` is the cheap half of closing it.
 */
export interface SerializedGoal {
  id: string;
  title: string;
  tag: string | null;
  targetSessions: number | null;
  progressMode: 'tasks' | 'sessions' | 'both';
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  linkedTaskCount: number;
  completedTaskCount: number;
  actualSessions: number;
  totalFocusSeconds: number;
  elapsedDays: number;
  taskProgress: number;
  sessionProgress: number | null;
  overallProgress: number;
}

/** Shape one goal for the wire, with server-computed progress attached. */
function serializeGoal(
  goal: {
    id: string;
    title: string;
    tag: string | null;
    targetSessions: number | null;
    progressMode: 'tasks' | 'sessions' | 'both';
    deadline: Date | null;
    isCompleted: boolean;
    completedAt: Date | null;
    isArchived: boolean;
    createdAt: Date;
  },
  counts: { linkedTaskCount: number; completedTaskCount: number; actualSessions: number; totalFocusSeconds: number },
): SerializedGoal {
  const progress = computeProgress(goal.progressMode, goal.targetSessions, counts);
  return {
    id:                 goal.id,
    title:              goal.title,
    tag:                goal.tag,
    targetSessions:     goal.targetSessions,
    progressMode:       progress.progressMode,
    deadline:           formatDeadline(goal.deadline),
    isCompleted:        goal.isCompleted,
    completedAt:        goal.completedAt?.toISOString() ?? null,
    isArchived:         goal.isArchived,
    createdAt:          goal.createdAt.toISOString(),
    linkedTaskCount:    progress.linkedTaskCount,
    completedTaskCount: progress.completedTaskCount,
    actualSessions:     progress.actualSessions,
    totalFocusSeconds:  progress.totalFocusSeconds,
    // Wall-clock days from creation to completion, or to now while still open.
    // Clamped at 0 because completedAt is client-supplied and unvalidated for
    // ordering, so a bad clock could otherwise render a negative age.
    elapsedDays:        Math.max(0, Math.round(
      ((goal.completedAt ?? new Date()).getTime() - goal.createdAt.getTime()) / 86_400_000,
    )),
    taskProgress:       progress.taskProgress,
    sessionProgress:    progress.sessionProgress,
    overallProgress:    progress.overallProgress,
  };
}

taskGoalsRouter.post('/task-goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const data = createSchema.parse(req.body);
    const taskIds = [...new Set(data.taskIds ?? [])];

    // All-or-nothing, checked BEFORE anything is written. The alternative —
    // create the goal, then attach in a second request — leaves a goal that
    // silently lacks the tasks the user just picked, and a rollback that can
    // itself fail. One transaction removes the state instead of handling it.
    if (taskIds.length > 0 && !(await userOwnsTasks(userId, taskIds))) {
      res.status(404).json({ success: false, error: 'One or more tasks were not found' });
      return;
    }

    // Task.taskGoalId holds ONE goal, so linking a task moves it off whatever
    // goal it was on. Capture those goals first: losing an unfinished task can
    // push the goal it left to 100%.
    const losing = taskIds.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: taskIds }, userId, taskGoalId: { not: null } },
          select: { taskGoalId: true },
        })
      : [];

    const goal = await prisma.$transaction(async (tx) => {
      const created = await tx.taskGoal.create({
        data: {
          userId,
          title:    data.title,
          tag:      data.tag ?? null,
          deadline: parseDeadline(data.deadline),
          // Stored, never read. Retained rather than dropped so that reverting
          // this change does not lose what older clients sent.
          targetSessions: data.targetSessions ?? null,
          progressMode:   'tasks',
        },
      });
      if (taskIds.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: taskIds }, userId },
          data:  { taskGoalId: created.id },
        });
      }
      return created;
    });

    // Linking an already-completed task can put the new goal at 100% on its
    // first breath, and a goal that just lost a task can cross it too.
    const affected = [goal.id, ...losing.map((t) => t.taskGoalId!)];
    await syncGoalCompletion(userId, affected);

    const counts = await loadGoalCounts(userId, [goal.id]);
    const fresh = await prisma.taskGoal.findFirst({ where: { id: goal.id, userId } });

    res.status(201).json({
      success: true,
      data: serializeGoal(fresh ?? goal, counts.get(goal.id) ?? NO_COUNTS),
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] create error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

taskGoalsRouter.get('/task-goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const goals = await prisma.taskGoal.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: 'desc' },
    });

    // Two grouped queries for every goal at once, instead of pulling each goal's
    // task rows just to count them.
    const counts = await loadGoalCounts(userId, goals.map((g) => g.id));

    const data = goals.map((g) =>
      serializeGoal(g, counts.get(g.id) ?? { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0, totalFocusSeconds: 0 }),
    );

    res.json({ success: true, data });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

taskGoalsRouter.patch('/task-goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    const data = updateSchema.parse(req.body);

    const existing = await prisma.taskGoal.findFirst({ where: { id, userId } });
    if (!existing) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }

    const update: Record<string, unknown> = {};
    if (data.title          !== undefined) update.title          = data.title;
    if (data.tag            !== undefined) update.tag            = data.tag;
    if (data.targetSessions !== undefined) update.targetSessions = data.targetSessions;
    if (data.deadline       !== undefined) update.deadline       = parseDeadline(data.deadline);
    if (data.isCompleted    !== undefined) update.isCompleted    = data.isCompleted;
    if (data.completedAt    !== undefined) update.completedAt    = data.completedAt ? new Date(data.completedAt) : null;

    // progressMode is deliberately NOT written from the request any more. It used
    // to be reconciled against targetSessions here so a goal could not claim a
    // sessions component it had no target to measure; progress is task-denominated
    // now, so there is one mode and the column is inert. An older client can still
    // SEND both fields — targetSessions is stored, progressMode is dropped.

    const goal = await prisma.taskGoal.update({ where: { id }, data: update });

    const counts = await loadGoalCounts(userId, [goal.id]);
    res.json({
      success: true,
      data: serializeGoal(goal, counts.get(goal.id) ?? { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0, totalFocusSeconds: 0 }),
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] update error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Add and remove task links on one goal.
 *
 * DELTAS, not a replacement set. The obvious shape — send the desired set, let
 * the server make it so — is a data-loss bug here: loadGoalCounts counts
 * COMPLETED tasks toward a goal, so a goal reading "3 of 6" has three completed
 * tasks carrying its taskGoalId. They never appear in a picker of open tasks, so
 * they would be absent from the payload, so replace semantics would clear them
 * and drop the goal to 0/3 on its first save. Archived recurring instances,
 * which inherit their template's taskGoalId, go the same way.
 *
 * With deltas the server touches only ids it was handed, so a task the client
 * never showed cannot become collateral damage. The bug is structurally
 * impossible rather than something every future caller has to remember.
 *
 *   link:   [a, b] ──► taskGoalId = this goal   (moves a and b off any other goal)
 *   unlink: [c]    ──► taskGoalId = null        (only if c is on THIS goal)
 *   untouched: everything else, including completed and archived rows
 */
taskGoalsRouter.post('/task-goals/:id/tasks', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    const body = linkSchema.parse(req.body);

    const link   = [...new Set(body.link   ?? [])];
    const unlink = [...new Set(body.unlink ?? [])];

    // Contradictory instructions are a client bug. Picking a winner silently is
    // how that bug survives to production unnoticed.
    const contradictory = link.filter((t) => unlink.includes(t));
    if (contradictory.length > 0) {
      res.status(400).json({
        success: false,
        error: 'A task cannot be both linked and unlinked in one request',
      });
      return;
    }

    const goal = await prisma.taskGoal.findFirst({ where: { id, userId } });
    if (!goal) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }

    // Every id verified before anything is written: a partial link on a bad id
    // leaves the client believing it saved something it did not.
    if (!(await userOwnsTasks(userId, [...link, ...unlink]))) {
      res.status(404).json({ success: false, error: 'One or more tasks were not found' });
      return;
    }

    // Task.taskGoalId holds one goal, so linking MOVES a task. The goals it
    // moves away from change too, and losing an unfinished task can push one of
    // them to 100%.
    const losing = link.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: link }, userId, taskGoalId: { not: null } },
          select: { taskGoalId: true },
        })
      : [];

    const writes = [];
    if (link.length > 0) {
      writes.push(prisma.task.updateMany({
        where: { id: { in: link }, userId },
        data:  { taskGoalId: id },
      }));
    }
    if (unlink.length > 0) {
      // Scoped to THIS goal: this endpoint can never clear a task's link to a
      // goal it was not called on.
      writes.push(prisma.task.updateMany({
        where: { id: { in: unlink }, userId, taskGoalId: id },
        data:  { taskGoalId: null },
      }));
    }
    if (writes.length > 0) await prisma.$transaction(writes);

    // A task already on THIS goal is not "moving away" from anything.
    const affected = [...new Set([
      id,
      ...losing.map((t) => t.taskGoalId).filter((g): g is string => !!g && g !== id),
    ])];
    await syncGoalCompletion(userId, affected);

    const fresh = await prisma.taskGoal.findFirst({ where: { id, userId } });
    const counts = await loadGoalCounts(userId, [id]);

    res.json({
      success: true,
      data: serializeGoal(fresh ?? goal, counts.get(id) ?? NO_COUNTS),
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] link error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

taskGoalsRouter.delete('/task-goals/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const existing = await prisma.taskGoal.findFirst({ where: { id, userId } });
    if (!existing) { res.status(404).json({ success: false, error: 'Goal not found' }); return; }

    // Sever the link as well as archiving the goal. Previously the goal was only
    // hidden and every task kept a taskGoalId pointing at it, so the chip
    // vanished from the UI while the row still referenced an archived goal.
    await prisma.$transaction([
      prisma.task.updateMany({ where: { taskGoalId: id, userId }, data: { taskGoalId: null } }),
      prisma.taskGoal.update({ where: { id }, data: { isArchived: true } }),
    ]);

    res.json({ success: true, data: null });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
