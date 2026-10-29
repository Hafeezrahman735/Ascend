import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Which goal a focus session counts toward: its task's CURRENT goal.
 *
 * Owner decision, 2026-10-23. Goal time follows the task, so:
 *
 *   - linking an already-worked task to a goal brings its past time with it;
 *   - moving a task from goal A to goal B moves all of its time to B;
 *   - unlinking a task takes its time off the goal (it shows as not linked).
 *
 * A recurring task is one task for this purpose too: every session on it
 * points at the recurring task itself, so its link decides for all of them.
 *
 * A session with no task (the free timer) has no goal. Overall totals never
 * depend on any of this: every focus session counts exactly once.
 *
 * `session.taskGoalId` and `goalTitleSnapshot` are NOT read here, nor by any
 * goal-level number. They record which goal a session was for when it was
 * logged; that is history, kept as metadata, not the current attribution.
 *
 * This file is the only place the rule is written down. The SQL fragment is for
 * grouped queries and the JS function for code that already holds task rows;
 * the integration tests check that both agree.
 */

/**
 * Joins a `sessions s` row to its task, scoped to the session's own user, so a
 * task id that somehow pointed at another account could never pull that
 * account's goal in.
 */
export const SESSION_GOAL_JOIN = Prisma.sql`
  LEFT JOIN tasks t ON t.id = s.task_id AND t.user_id = s.user_id`;

/** The session's current goal id, given SESSION_GOAL_JOIN. Mirrors loadCurrentGoals. */
export const SESSION_GOAL_EXPR = Prisma.sql`t.task_goal_id`;

/**
 * Current goal for each of these task ids (archived tasks included: their
 * sessions still count). Ids that are not this user's resolve to no goal.
 */
export async function loadCurrentGoals(
  userId: string,
  taskIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(taskIds)];
  const result = new Map<string, string | null>();
  if (ids.length === 0) return result;

  const tasks = await prisma.task.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, taskGoalId: true },
  });
  for (const task of tasks) result.set(task.id, task.taskGoalId);
  return result;
}
