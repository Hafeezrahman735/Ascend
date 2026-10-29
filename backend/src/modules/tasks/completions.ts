import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { resolveLocalDate } from '../../lib/localDate';
import { applyCompletionChange, completionDateError } from '../../lib/recurringOccurrences';

/**
 * Ticking off a recurring task: PUT marks a day done, DELETE marks it not done.
 *
 * Only the HTTP layer lives here — the rules and side effects are in
 * lib/recurringOccurrences.ts. Both verbs are
 * idempotent: repeating one returns 200 with `changed: false` and pays nothing.
 */
export function setupCompletionRoutes(router: Router): void {
  router.put('/tasks/:id/completions/:date', (req, res) => setCompletion(req, res, true));
  router.delete('/tasks/:id/completions/:date', (req, res) => setCompletion(req, res, false));
}

const bodySchema = z.object({ localDate: z.string().optional().nullable() });

async function setCompletion(req: Request, res: Response, done: boolean): Promise<void> {
  try {
    const userId = authenticate(req);
    const { id, date } = req.params;
    // `?localDate=` or a body field: a DELETE usually carries no body.
    const fromQuery = typeof req.query.localDate === 'string' ? req.query.localDate : undefined;
    const { localDate } = bodySchema.parse(req.body ?? {});
    const today = resolveLocalDate(fromQuery ?? localDate, new Date(), `${req.method} /tasks/:id/completions`);

    // One answer for "not yours", "not recurring", "gone" and "never existed",
    // so the endpoint reveals nothing about other users' tasks.
    const task = await prisma.task.findFirst({
      where: { id, userId, isRecurring: true, isArchived: false },
      select: { recurringDays: true, dueDate: true, createdAt: true },
    });
    if (!task) {
      res.status(404).json({ success: false, error: 'Recurring task not found' });
      return;
    }

    const dateError = completionDateError(task, date, today);
    if (dateError) {
      res.status(400).json({ success: false, error: dateError });
      return;
    }

    const { changed, reward } = await applyCompletionChange(userId, id, date, done, today);
    res.json({ success: true, data: { taskId: id, date, done, changed }, reward });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    if (handleAuthError(res, err)) return;
    console.error('Set recurring completion error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
