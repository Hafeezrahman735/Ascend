import { prisma } from './prisma';

/**
 * One-time cutover: move one-off tasks' times onto work blocks.
 *
 * Before work blocks, a one-off task's dueDate was both its deadline and the
 * day its startMinutes/endMinutes sat on (docs/designs/task-due-and-work-blocks.md).
 * Which one the user meant cannot be known, so nothing is lost (design D3, D5):
 *
 *   timed one-off task ──► one work block on its due day, with its times
 *                         its due date is kept as the deadline
 *                         its own times are cleared (blocks now hold them)
 *   one end only ───────► times cleared (no block: half a time is not a time)
 *   recurring tasks ────► untouched (a habit's time stays on the task)
 *
 * Idempotent: a block that already exists (same task, day, start) is skipped,
 * and a re-run finds no times left to move. Archived tasks are included so a
 * later restore still finds the block.
 *
 * Run with the release that reads work blocks: the server refuses times on
 * one-off tasks from then on, so an older app build cannot write new ones.
 */

export interface WorkBlockCutoverResult {
  /** One-off tasks that had a full time pair and a due day. */
  timedTasks: number;
  /** Blocks inserted (timedTasks minus any that already had one). */
  blocksCreated: number;
  /** One-off tasks whose own times were cleared. */
  timesCleared: number;
}

/** UTC calendar day of a stored dueDate, as 'YYYY-MM-DD' (dueDate is UTC midnight). */
function dueDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runWorkBlockCutover({ dryRun }: { dryRun: boolean }): Promise<WorkBlockCutoverResult> {
  return prisma.$transaction(async (db) => {
    const withTimes = await db.task.findMany({
      where: {
        isRecurring: false,
        OR: [{ startMinutes: { not: null } }, { endMinutes: { not: null } }],
      },
      select: { id: true, userId: true, dueDate: true, startMinutes: true, endMinutes: true },
    });

    const timed = withTimes.filter(
      (t) => t.dueDate !== null && t.startMinutes !== null && t.endMinutes !== null && t.endMinutes > t.startMinutes,
    );

    if (dryRun) {
      const existing = await db.workBlock.count({
        where: { OR: timed.map((t) => ({ taskId: t.id, date: dueDay(t.dueDate!), startMinutes: t.startMinutes })) },
      });
      return { timedTasks: timed.length, blocksCreated: timed.length - (timed.length ? existing : 0), timesCleared: withTimes.length };
    }

    const created = await db.workBlock.createMany({
      data: timed.map((t) => ({
        userId: t.userId,
        taskId: t.id,
        date: dueDay(t.dueDate!),
        startMinutes: t.startMinutes,
        endMinutes: t.endMinutes,
      })),
      skipDuplicates: true,
    });

    const cleared = await db.task.updateMany({
      where: { id: { in: withTimes.map((t) => t.id) } },
      data: { startMinutes: null, endMinutes: null },
    });

    return { timedTasks: timed.length, blocksCreated: created.count, timesCleared: cleared.count };
  });
}
