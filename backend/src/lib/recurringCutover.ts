import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * One-time cutover: remove the daily copies of recurring tasks.
 *
 * Recurring tasks moved from "a template that spawns a copy each day" to "one
 * task plus a completion log" (docs/designs/recurring-tasks-rule-and-log.md).
 * No real user relied on the copies — the production owners were test
 * accounts — so there is no compatibility window and no reconciliation: the
 * copies go, in one transaction, keeping only what is cheap to keep.
 *
 *   live copy's goal ─► given to its recurring task, when that has none (older
 *                       builds linked a habit through today's copy only)
 *   completed copy ──► a RecurringCompletion row for its day (history of ticks)
 *   session on copy ──► re-pointed at the recurring task (its time stays counted
 *                       on the habit and its goal, instead of going unlinked)
 *   every copy ──────► deleted
 *
 * A copy whose recurring task no longer exists has nothing to point at: its
 * sessions are detached (task_id cleared by the foreign key) and keep their
 * taskLabel, so time reports still name them.
 *
 * Run ONLY together with the release that stops reading copies. Before it,
 * the app still shows today's copy as the recurring task's row.
 */

export interface CutoverResult {
  copies: number;
  goalLinksMoved: number;
  completionsAdded: number;
  sessionsRepointed: number;
  sessionsDetached: number;
}

/**
 * The goal of each recurring task's newest live copy, when that goal is the
 * same user's and still live. Only live copies count: they are the link the
 * user could see. Archived copies carry whatever goal they were spawned with.
 */
const LIVE_COPY_GOAL = Prisma.sql`
  SELECT DISTINCT ON (c.parent_task_id) c.parent_task_id, c.task_goal_id, g.user_id
  FROM tasks c
  JOIN task_goals g ON g.id = c.task_goal_id AND NOT g.is_archived
  WHERE c.parent_task_id IS NOT NULL AND NOT c.is_archived
  ORDER BY c.parent_task_id, c.due_date DESC NULLS LAST, c.created_at DESC`;

/** A live recurring task with no goal of its own takes its copy's. */
const TAKES_COPY_GOAL = Prisma.sql`
  p.is_recurring AND NOT p.is_archived AND p.task_goal_id IS NULL AND c.user_id = p.user_id`;

export async function runRecurringCutover({ dryRun }: { dryRun: boolean }): Promise<CutoverResult> {
  return prisma.$transaction(async (db) => {
    const [counts] = await db.$queryRaw<Array<Record<keyof CutoverResult, number>>>`
      SELECT
        (SELECT COUNT(*)::int FROM tasks WHERE parent_task_id IS NOT NULL) AS "copies",
        (SELECT COUNT(*)::int FROM tasks p JOIN (${LIVE_COPY_GOAL}) c ON c.parent_task_id = p.id
           WHERE ${TAKES_COPY_GOAL}) AS "goalLinksMoved",
        (SELECT COUNT(DISTINCT (c.parent_task_id, to_char(c.due_date, 'YYYY-MM-DD')))::int
           FROM tasks c
           JOIN tasks p ON p.id = c.parent_task_id
           WHERE c.is_completed AND c.due_date IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM recurring_completions rc
               WHERE rc.task_id = c.parent_task_id
                 AND rc.date = to_char(c.due_date, 'YYYY-MM-DD'))) AS "completionsAdded",
        (SELECT COUNT(*)::int FROM sessions s
           JOIN tasks c ON c.id = s.task_id
           JOIN tasks p ON p.id = c.parent_task_id) AS "sessionsRepointed",
        (SELECT COUNT(*)::int FROM sessions s
           JOIN tasks c ON c.id = s.task_id
           WHERE c.parent_task_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = c.parent_task_id)) AS "sessionsDetached"`;
    if (dryRun) return counts;

    await db.$executeRaw`
      UPDATE tasks p
      SET task_goal_id = c.task_goal_id
      FROM (${LIVE_COPY_GOAL}) c
      WHERE c.parent_task_id = p.id AND ${TAKES_COPY_GOAL}`;

    // A copy's dueDate is midnight UTC of its local day (lib/localDate.ts), so
    // its UTC date string is the day it stood for.
    await db.$executeRaw`
      INSERT INTO recurring_completions (id, user_id, task_id, date, completed_at)
      SELECT DISTINCT ON (c.parent_task_id, to_char(c.due_date, 'YYYY-MM-DD'))
             gen_random_uuid()::text, p.user_id, c.parent_task_id,
             to_char(c.due_date, 'YYYY-MM-DD'), COALESCE(c.completed_at, c.updated_at)
      FROM tasks c
      JOIN tasks p ON p.id = c.parent_task_id
      WHERE c.is_completed AND c.due_date IS NOT NULL
      ON CONFLICT (task_id, date) DO NOTHING`;

    await db.$executeRaw`
      UPDATE sessions s
      SET task_id = c.parent_task_id
      FROM tasks c
      JOIN tasks p ON p.id = c.parent_task_id
      WHERE s.task_id = c.id`;

    await db.$executeRaw`DELETE FROM tasks WHERE parent_task_id IS NOT NULL`;

    return counts;
  }, { timeout: 60_000 });
}
