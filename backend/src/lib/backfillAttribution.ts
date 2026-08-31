import type { PrismaClient } from '@prisma/client';
import { buildAttribution } from './sessionAttribution';
import { utcDateStr } from './localDate';

/**
 * One-time backfill of frozen session attribution.
 *
 * Idempotent: only touches sessions that have not been stamped yet
 * (`localDate IS NULL`), so re-running it is safe and re-running after new
 * sessions arrive is a no-op.
 *
 * Lives here rather than in the script so it can be tested against a real
 * database — this writes to every session row a user has, which is not
 * something to ship on the strength of having read it carefully.
 *
 * ─── What this can and cannot recover ───────────────────────────────────────
 *
 * CAN: tags, goal, title and priority for any session whose task row still
 * exists — including ARCHIVED tasks. That is the whole point. The read-time
 * path this replaces went through GET /tasks, which filters isArchived, so
 * every recurring-habit session older than a day had already lost its
 * attribution. Reading Prisma directly gets it back.
 *
 * CANNOT: the user's timezone at the time. It was never recorded and there is
 * no timezone on User to fall back to, so historical rows get the UTC day and
 * hour with `localDateApprox = true` and the report footnotes them. Someone in
 * UTC-5 will see some old evening sessions land on the next day. New sessions
 * carry the client's real zone and are exact.
 *
 * CANNOT: sessions whose task row is gone entirely. They stay unattributed,
 * which is the honest answer — nothing knows what they were for.
 */

/** Rows read and written per pass. Keeps memory flat on a large history. */
const BATCH_SIZE = 500;

/**
 * Explicit, so `sessions` does not have to be inferred from a query whose
 * `where` reads `cursor` — which `cursor` is then assigned from. TypeScript
 * sees that as circular and falls back to `any`.
 */
interface SessionRow {
  id: string;
  taskId: string | null;
  completedAt: Date;
}

export interface BackfillTally {
  scanned: number;
  /** Task row still existed, so tags/goal/title were recovered. */
  attributed: number;
  /**
   * Never had a task — a free-form timer run. Nothing was lost and nothing is
   * recoverable, because there was never anything to recover. Counted apart
   * from `taskMissing` because lumping the two together reports a healthy
   * database as a damaged one.
   */
  noTask: number;
  /** Pointed at a task row that no longer exists. Genuinely unrecoverable. */
  taskMissing: number;
  withGoal: number;
  recurring: number;
}

export async function backfillSessionAttribution(
  prisma: PrismaClient,
  opts: { dryRun?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<BackfillTally & { total: number }> {
  const dryRun = opts.dryRun ?? false;
  const tally: BackfillTally = {
    scanned: 0, attributed: 0, noTask: 0, taskMissing: 0, withGoal: 0, recurring: 0,
  };

  const total = await prisma.session.count({ where: { localDate: null } });
  if (total === 0) return { ...tally, total };

  // Only the dry run needs a cursor. A real run removes rows from the
  // `localDate: null` filter as it writes, so re-reading the first page always
  // returns fresh work; paging with an offset would skip half the table.
  //
  // Null rather than '' until the first page lands: Session.id is a uuid
  // column, and Postgres rejects an empty string as one rather than treating
  // it as "before everything".
  let cursor: string | null = null;

  for (;;) {
    const sessions: SessionRow[] = await prisma.session.findMany({
      where: {
        localDate: null,
        ...(dryRun && cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, taskId: true, completedAt: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (sessions.length === 0) break;
    cursor = sessions[sessions.length - 1].id;

    // Bulk-load the tasks these sessions point at. No isArchived filter — the
    // archived rows are exactly the ones the old read path could not see.
    const taskIds = [...new Set(sessions.map((s) => s.taskId).filter((t): t is string => !!t))];
    const tasks = taskIds.length
      ? await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: {
            id: true, title: true, tags: true, priority: true,
            taskGoalId: true, isRecurring: true, parentTaskId: true,
          },
        })
      : [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const goalIds = [...new Set(tasks.map((t) => t.taskGoalId).filter((g): g is string => !!g))];
    const goals = goalIds.length
      ? await prisma.taskGoal.findMany({
          where: { id: { in: goalIds } },
          select: { id: true, title: true },
        })
      : [];
    const goalById = new Map(goals.map((g) => [g.id, g]));

    for (const session of sessions) {
      const task = (session.taskId && taskById.get(session.taskId)) || null;
      const goal = (task?.taskGoalId && goalById.get(task.taskGoalId)) || null;

      const stamp = buildAttribution({
        task,
        goal,
        completedAt: session.completedAt,
        // UTC day — the user's zone at the time is unrecoverable.
        // buildAttribution flags localDateApprox itself when given no zone.
        localDate: utcDateStr(session.completedAt),
        timeZone: null,
      });

      tally.scanned++;
      if (task) tally.attributed++;
      else if (session.taskId) tally.taskMissing++;
      else tally.noTask++;
      if (stamp.taskGoalId) tally.withGoal++;
      if (stamp.wasRecurring) tally.recurring++;

      if (!dryRun) {
        await prisma.session.update({ where: { id: session.id }, data: stamp });
      }
    }

    opts.onProgress?.(tally.scanned, total);
    if (dryRun && sessions.length < BATCH_SIZE) break;
  }

  return { ...tally, total };
}
