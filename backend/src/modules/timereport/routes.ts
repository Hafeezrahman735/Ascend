import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { shiftDateKey, daysBetweenKeys, safeTimeZone, localPartsOf } from '../../lib/localParts';
import { computeTimeReport, type ReportSession } from '../../lib/timeReport';
import { loadCurrentGoals } from '../../lib/goalAttribution';
import { postgresTimeZone, sessionLocalDaySql } from '../../lib/localDaySql';

/**
 * `GET /time-report?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Reads attribution frozen onto the session rows (titles, tags, local day;
 * see lib/sessionAttribution.ts) and aggregates it. The one exception is the
 * GOAL: a session counts toward its task's current goal, resolved once per
 * task by lib/goalAttribution.ts, so relinking a task moves its time. The
 * frozen `taskGoalId` / `goalTitleSnapshot` are deliberately not selected.
 *
 * The query is by `completedAt`, NOT by the stored `localDate`, and it is
 * widened by a day at each end. Two reasons, both load-bearing:
 *
 *   - A backfilled row's `localDate` is a UTC guess and can be a whole day out
 *     (see computeTimeReport). Filtering on it in SQL would drop sessions from
 *     the window before anything had a chance to correct them — which is
 *     exactly how an evening session vanished from "today" and from its month.
 *   - Once resolved, a session's local day can be a day either side of its UTC
 *     day, so the fetch has to cover more than the requested range and let the
 *     aggregation decide what actually falls inside it.
 */

export const timeReportRouter = Router();

/**
 * Widest window we will aggregate in one request. A heavy user at twenty
 * sessions a day produces ~1800 rows a quarter, so this leaves generous room
 * while stopping an "all time" request on a huge history from pulling an
 * unbounded result set into memory.
 */
const MAX_REPORT_SESSIONS = 20_000;

/** Longest range accepted, in days. Two years covers any real retrospective. */
const MAX_RANGE_DAYS = 730;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  from: z.string().regex(DATE, 'from must be YYYY-MM-DD'),
  to: z.string().regex(DATE, 'to must be YYYY-MM-DD'),
  tz: z.string().max(64).optional(),
});

/** Only the columns the report reads. */
const REPORT_SELECT = {
  completedAt: true,
  durationSeconds: true,
  taskId: true,
  taskTitleSnapshot: true,
  primaryTag: true,
  tags: true,
  priority: true,
  wasRecurring: true,
  localDate: true,
  localHour: true,
  localWeekday: true,
  localDateApprox: true,
} as const;

type SessionRow = {
  completedAt: Date;
  durationSeconds: number;
  taskId: string | null;
  taskTitleSnapshot: string | null;
  primaryTag: string | null;
  tags: string[];
  priority: string | null;
  wasRecurring: boolean;
  localDate: string | null;
  localHour: number | null;
  localWeekday: number | null;
  localDateApprox: boolean;
};

/**
 * Nulls are passed through rather than defaulted: a row with no stamp is one
 * computeTimeReport must resolve from `completedAt`, and defaulting it to
 * midnight-on-the-epoch would file it under the wrong day silently.
 */
function toReportSession(row: SessionRow, goalByTask: Map<string, string | null>): ReportSession {
  return {
    completedAt: row.completedAt,
    durationSeconds: row.durationSeconds,
    taskId: row.taskId,
    goalId: row.taskId ? goalByTask.get(row.taskId) ?? null : null,
    taskTitleSnapshot: row.taskTitleSnapshot,
    primaryTag: row.primaryTag,
    tags: row.tags,
    priority: row.priority,
    wasRecurring: row.wasRecurring,
    localDate: row.localDate,
    localHour: row.localHour,
    localWeekday: row.localWeekday,
    localDateApprox: row.localDateApprox,
  };
}

timeReportRouter.get('/time-report', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid range' });
      return;
    }
    const { from, to, tz } = parsed.data;

    const span = daysBetweenKeys(from, to);
    if (span < 0) {
      res.status(400).json({ success: false, error: 'from must not be after to' });
      return;
    }
    if (span + 1 > MAX_RANGE_DAYS) {
      res.status(400).json({ success: false, error: `Range must be ${MAX_RANGE_DAYS} days or fewer` });
      return;
    }

    // Same-length window ending the day before `from`.
    const days = span + 1;
    const prevTo = shiftDateKey(from, -1);
    const prevFrom = shiftDateKey(prevTo, -(days - 1));

    // One read covering both windows, widened a day at each end because a
    // session's resolved local day can sit either side of its UTC day.
    const fetchFrom = new Date(`${shiftDateKey(prevFrom, -1)}T00:00:00.000Z`);
    const fetchTo = new Date(`${shiftDateKey(to, 1)}T23:59:59.999Z`);

    const [rows, goals] = await Promise.all([
      // Newest first, one row past the cap: if the cap is hit, the rows dropped
      // are the oldest (the previous-window comparison goes first), and the
      // response says so instead of presenting partial totals as complete.
      prisma.session.findMany({
        where: { userId, type: 'focus', completedAt: { gte: fetchFrom, lte: fetchTo } },
        select: REPORT_SELECT,
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: MAX_REPORT_SESSIONS + 1,
      }),
      prisma.taskGoal.findMany({
        where: { userId, isArchived: false },
        select: { id: true, title: true, deadline: true, isCompleted: true },
      }),
    ]);

    // The caller's zone, used both to place "today" for deadline maths and to
    // re-resolve any session whose stored local day was a UTC guess.
    const timeZone = safeTimeZone(tz);
    const today = localPartsOf(new Date(), timeZone).dateKey;

    const truncated = rows.length > MAX_REPORT_SESSIONS;
    if (truncated) rows.length = MAX_REPORT_SESSIONS;

    const goalByTask = await loadCurrentGoals(
      userId,
      rows.map((r) => r.taskId).filter((t): t is string => !!t),
    );

    const report = computeTimeReport({
      sessions: rows.map((r) => toReportSession(r, goalByTask)),
      from,
      to,
      previousFrom: prevFrom,
      previousTo: prevTo,
      timeZone,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
        isCompleted: g.isCompleted,
      })),
      today,
    });

    // There used to be an `unstampedSessions` count here, to tell "you did not
    // work" apart from "the backfill has not run yet". It is gone because the
    // second case can no longer produce an empty report: computeTimeReport
    // resolves a session with no stamp from its `completedAt`, so every session
    // lands on a day whether it was ever backfilled or not.
    res.json({ success: true, data: { ...report, truncated } });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Time report error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const historyQuerySchema = z.object({
  tz: z.string().max(64).optional(),
});

/**
 * `GET /time-report/history?tz=IANA` — all-time focus, by local day.
 *
 * Grouped in SQL with no row cap, so it is complete for any history: one row
 * per day with focus, plus monthly totals and the all-time total. Each session
 * lands on the same local day as in /time-report (lib/localDaySql.ts).
 *
 * Server-confirmed sessions only. Sessions still waiting in the app's outbox
 * are not here; the app shows those separately.
 */
timeReportRouter.get('/time-report/history', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }
    const timeZone = await postgresTimeZone(safeTimeZone(parsed.data.tz));
    const day = sessionLocalDaySql(timeZone);

    const daily = await prisma.$queryRaw<{ date: string; seconds: number; sessions: number }[]>`
      SELECT ${day} AS date,
             COALESCE(SUM(s.duration_seconds), 0)::int AS seconds,
             COUNT(*)::int AS sessions
      FROM sessions s
      WHERE s.user_id = ${userId}::uuid AND s.type = 'focus'
      GROUP BY 1
      ORDER BY 1`;

    const monthly = new Map<string, { seconds: number; sessions: number }>();
    let seconds = 0;
    let sessions = 0;
    for (const d of daily) {
      seconds += d.seconds;
      sessions += d.sessions;
      const key = d.date.slice(0, 7);
      const m = monthly.get(key) ?? { seconds: 0, sessions: 0 };
      m.seconds += d.seconds;
      m.sessions += d.sessions;
      monthly.set(key, m);
    }

    res.json({
      success: true,
      data: {
        timeZone,
        allTime: { seconds, sessions, activeDays: daily.length, firstDate: daily[0]?.date ?? null },
        daily,
        monthly: [...monthly.entries()].map(([month, m]) => ({ month, ...m })),
      },
    });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Time history error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
