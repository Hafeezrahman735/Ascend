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
 * A habit is one task for this purpose. Each day of a habit is its own row
 * (an instance with `parentTaskId`), and archived instances keep whatever goal
 * they were spawned with, so reading the instance's own link would leave a
 * moved habit's history behind on the old goal. The TEMPLATE's link decides
 * for every instance, past and present.
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

export interface AttributableTask {
  taskGoalId: string | null;
  parentTaskId: string | null;
}

/** The current goal for a session's task, given the task and (for a habit instance) its template. */
export function currentGoalOf(
  task: AttributableTask | null | undefined,
  template: Pick<AttributableTask, 'taskGoalId'> | null | undefined,
): string | null {
  if (!task) return null;
  if (task.parentTaskId) return template?.taskGoalId ?? null;
  return task.taskGoalId;
}

/**
 * Joins a `sessions s` row to its task and, for a habit instance, the template.
 * Both joins are scoped to the session's own user, so a task id that somehow
 * pointed at another account could never pull that account's goal in.
 */
export const SESSION_GOAL_JOIN = Prisma.sql`
  LEFT JOIN tasks t ON t.id = s.task_id AND t.user_id = s.user_id
  LEFT JOIN tasks tpl ON tpl.id = t.parent_task_id AND tpl.user_id = s.user_id`;

/** The session's current goal id, given SESSION_GOAL_JOIN. Mirrors currentGoalOf. */
export const SESSION_GOAL_EXPR = Prisma.sql`(CASE WHEN t.parent_task_id IS NOT NULL THEN tpl.task_goal_id ELSE t.task_goal_id END)`;

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
    select: { id: true, taskGoalId: true, parentTaskId: true },
  });
  const templateIds = [...new Set(tasks.map((t) => t.parentTaskId).filter((p): p is string => !!p))];
  const templates = templateIds.length > 0
    ? await prisma.task.findMany({
        where: { userId, id: { in: templateIds } },
        select: { id: true, taskGoalId: true },
      })
    : [];
  const templateById = new Map(templates.map((t) => [t.id, t]));

  for (const task of tasks) {
    result.set(task.id, currentGoalOf(task, task.parentTaskId ? templateById.get(task.parentTaskId) : null));
  }
  return result;
}
