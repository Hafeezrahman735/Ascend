import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { computeProgress, loadGoalCounts, resolveProgressMode } from '../../lib/goalProgress';

export const taskGoalsRouter = Router();

const PROGRESS_MODES = ['tasks', 'sessions', 'both'] as const;

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
  targetSessions: z.number().int().positive().max(200).optional().nullable(),
  deadline:       deadlineSchema.optional().nullable(),
  progressMode:   z.enum(PROGRESS_MODES).optional(),
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
  counts: { linkedTaskCount: number; completedTaskCount: number; actualSessions: number },
) {
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
    taskProgress:       progress.taskProgress,
    sessionProgress:    progress.sessionProgress,
    overallProgress:    progress.overallProgress,
  };
}

taskGoalsRouter.post('/task-goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const data = createSchema.parse(req.body);

    const targetSessions = data.targetSessions ?? null;
    // A goal created with a session target measures both by default; the client
    // can still pass progressMode explicitly to override.
    const requestedMode = data.progressMode ?? (targetSessions ? 'both' : 'tasks');
    const progressMode = resolveProgressMode(requestedMode, targetSessions);

    const goal = await prisma.taskGoal.create({
      data: {
        userId,
        title:          data.title,
        tag:            data.tag ?? null,
        targetSessions,
        progressMode,
        deadline:       parseDeadline(data.deadline),
      },
    });

    res.status(201).json({
      success: true,
      data: serializeGoal(goal, { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }),
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
      serializeGoal(g, counts.get(g.id) ?? { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }),
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

    // Keep progressMode consistent with whatever targetSessions ends up being,
    // so a goal can't be left claiming a sessions component it can't measure.
    const nextTarget =
      data.targetSessions !== undefined ? data.targetSessions : existing.targetSessions;
    if (data.progressMode !== undefined) {
      update.progressMode = resolveProgressMode(data.progressMode, nextTarget);
    } else if (data.targetSessions !== undefined) {
      const carried = resolveProgressMode(existing.progressMode, nextTarget);
      // Adding a target to a tasks-only goal promotes it to 'both', mirroring create.
      update.progressMode = nextTarget && existing.progressMode === 'tasks' ? 'both' : carried;
    }

    const goal = await prisma.taskGoal.update({ where: { id }, data: update });

    const counts = await loadGoalCounts(userId, [goal.id]);
    res.json({
      success: true,
      data: serializeGoal(goal, counts.get(goal.id) ?? { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }),
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] update error:', err);
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
