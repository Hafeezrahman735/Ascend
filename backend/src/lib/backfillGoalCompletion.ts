import { prisma } from './prisma';
import { loadGoalCounts } from './goalProgress';

/**
 * One-time backfill: complete the goals that only became complete because goal
 * progress stopped counting sessions.
 *
 * A goal used to be measurable on tasks, on sessions, or on a flat 50/50 blend
 * of both. Collapsing that to tasks alone moves a population across the line for
 * the first time: every 'both' goal with all its tasks done but its session
 * target unmet was sitting at (1.0 + n) / 2 and is now exactly 1.0.
 *
 * Left alone, syncGoalCompletion would find each of those the next time the user
 * touched one of its tasks and fire the full celebration — XP, a goal_completed
 * feed event, a push notification — for work finished weeks ago, trickling out
 * over days with nothing to explain it. A lump of XP that crosses a rank
 * threshold with no visible cause reads as a bug to the person it happens to.
 *
 * So this completes them SILENTLY. It never calls syncGoalCompletion, never
 * awards XP and never emits an event. The state becomes honest; nobody is
 * congratulated twice.
 *
 *   goal, not archived, not completed
 *          │
 *          ├─ 0 linked tasks ────────────► skip (0%, not 100% — an empty goal
 *          │                                is not a finished one)
 *          ├─ completed < linked ────────► skip (genuinely still open)
 *          └─ completed === linked ──────► complete, silently, dated by the
 *                                          goal's LAST finished task
 */

export interface GoalCompletionBackfillResult {
  scanned: number;
  completed: number;
  stillOpen: number;
  empty: number;
}

export interface GoalCompletionBackfillOptions {
  dryRun: boolean;
  onProgress?: (done: number, total: number) => void;
}

export async function backfillGoalCompletion(
  { dryRun, onProgress }: GoalCompletionBackfillOptions,
): Promise<GoalCompletionBackfillResult> {
  const goals = await prisma.taskGoal.findMany({
    where: { isArchived: false, isCompleted: false },
    select: { id: true, userId: true },
  });

  const result: GoalCompletionBackfillResult = {
    scanned: goals.length, completed: 0, stillOpen: 0, empty: 0,
  };
  if (goals.length === 0) return result;

  // Counts are loaded per user, because loadGoalCounts scopes every query by
  // userId — a task belonging to someone else must never contribute to this
  // user's goal even if it somehow carries the id.
  const byUser = new Map<string, string[]>();
  for (const g of goals) {
    const list = byUser.get(g.userId) ?? [];
    list.push(g.id);
    byUser.set(g.userId, list);
  }

  // When a goal did finish, it finished on the day its last task was ticked off.
  // Stamping completedAt with "now" would date weeks-old work to the migration.
  const lastDone = await prisma.task.groupBy({
    by: ['taskGoalId'],
    where: { taskGoalId: { in: goals.map((g) => g.id) }, isCompleted: true },
    _max: { completedAt: true },
  });
  const finishedAt = new Map(
    lastDone
      .filter((r) => r.taskGoalId)
      .map((r) => [r.taskGoalId as string, r._max.completedAt]),
  );

  let done = 0;
  for (const [userId, goalIds] of byUser) {
    const counts = await loadGoalCounts(userId, goalIds);

    for (const goalId of goalIds) {
      done += 1;
      onProgress?.(done, goals.length);

      const c = counts.get(goalId);
      if (!c || c.linkedTaskCount === 0) { result.empty += 1; continue; }
      if (c.completedTaskCount < c.linkedTaskCount) { result.stillOpen += 1; continue; }

      result.completed += 1;
      if (dryRun) continue;

      // Conditional on isCompleted:false so a concurrent request that completed
      // it the normal way (with its celebration) wins, and this does not
      // overwrite that goal's completedAt.
      await prisma.taskGoal.updateMany({
        where: { id: goalId, userId, isCompleted: false },
        data: {
          isCompleted: true,
          completedAt: finishedAt.get(goalId) ?? new Date(),
        },
      });
    }
  }

  return result;
}
