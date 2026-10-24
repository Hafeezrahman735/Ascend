import { prisma } from './prisma';

/**
 * One-time backfill: give a habit's template the goal its live instance has.
 *
 * Goal time now follows the habit TEMPLATE's link (lib/goalAttribution.ts).
 * Before linkHabitCounterparts existed, the app linked a habit to a goal
 * through whichever row it showed, which was today's instance, and left the
 * template unlinked. For those habits the template has no goal, so under the
 * template rule their time would read as not linked.
 *
 *   template, recurring, not archived, no goal
 *          │
 *          ├─ no live instance with a goal ──► skip (genuinely unlinked)
 *          └─ live instance(s) with a goal ──► template takes the goal of the
 *                                              newest live instance
 *
 * Only live (non-archived) instances are consulted: they are the link the
 * user can currently see. Archived instances carry whatever goal they were
 * spawned with, which is history, not intent.
 */

export interface HabitGoalBackfillResult {
  scanned: number;
  linked: number;
}

export async function backfillHabitGoalLinks({ dryRun }: { dryRun: boolean }): Promise<HabitGoalBackfillResult> {
  const templates = await prisma.task.findMany({
    where: { isRecurring: true, isArchived: false, taskGoalId: null },
    select: { id: true, userId: true },
  });
  const result: HabitGoalBackfillResult = { scanned: templates.length, linked: 0 };
  if (templates.length === 0) return result;

  for (const template of templates) {
    const live = await prisma.task.findFirst({
      where: {
        userId: template.userId,
        parentTaskId: template.id,
        isArchived: false,
        taskGoalId: { not: null },
      },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      select: { taskGoalId: true },
    });
    if (!live?.taskGoalId) continue;

    // The goal must be the same user's and still live; a stale id is skipped.
    const goal = await prisma.taskGoal.findFirst({
      where: { id: live.taskGoalId, userId: template.userId, isArchived: false },
      select: { id: true },
    });
    if (!goal) continue;

    result.linked += 1;
    if (!dryRun) {
      await prisma.task.update({ where: { id: template.id }, data: { taskGoalId: goal.id } });
    }
  }
  return result;
}
