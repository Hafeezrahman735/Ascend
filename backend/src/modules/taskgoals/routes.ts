import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';

export const taskGoalsRouter = Router();

const createSchema = z.object({
  title:          z.string().min(1).max(80),
  tag:            z.string().max(30).optional().nullable(),
  targetSessions: z.number().int().positive().optional().nullable(),
  deadline:       z.string().datetime({ offset: true }).optional().nullable(),
});

const updateSchema = z.object({
  title:          z.string().min(1).max(80).optional(),
  tag:            z.string().max(30).optional().nullable(),
  targetSessions: z.number().int().positive().optional().nullable(),
  deadline:       z.string().datetime({ offset: true }).optional().nullable(),
  isCompleted:    z.boolean().optional(),
  completedAt:    z.string().datetime({ offset: true }).optional().nullable(),
});

taskGoalsRouter.post('/task-goals', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const data = createSchema.parse(req.body);

    const goal = await prisma.taskGoal.create({
      data: {
        userId,
        title:          data.title,
        tag:            data.tag ?? null,
        targetSessions: data.targetSessions ?? null,
        deadline:       data.deadline ? new Date(data.deadline) : null,
      },
    });

    res.status(201).json({ success: true, data: goal });
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
      include: {
        _count: { select: { tasks: { where: { isArchived: false } } } },
        tasks: { where: { isArchived: false }, select: { isCompleted: true } },
      },
    });

    const data = goals.map((g) => ({
      id:                  g.id,
      title:               g.title,
      tag:                 g.tag,
      targetSessions:      g.targetSessions,
      deadline:            g.deadline?.toISOString() ?? null,
      isCompleted:         g.isCompleted,
      completedAt:         g.completedAt?.toISOString() ?? null,
      isArchived:          g.isArchived,
      createdAt:           g.createdAt.toISOString(),
      linkedTaskCount:     g._count.tasks,
      completedTaskCount:  g.tasks.filter((t) => t.isCompleted).length,
    }));

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
    if (data.deadline       !== undefined) update.deadline       = data.deadline ? new Date(data.deadline) : null;
    if (data.isCompleted    !== undefined) update.isCompleted    = data.isCompleted;
    if (data.completedAt    !== undefined) update.completedAt    = data.completedAt ? new Date(data.completedAt) : null;

    const goal = await prisma.taskGoal.update({ where: { id }, data: update });

    res.json({ success: true, data: goal });
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

    await prisma.taskGoal.update({ where: { id }, data: { isArchived: true } });

    res.json({ success: true, data: null });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[task-goals] delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
