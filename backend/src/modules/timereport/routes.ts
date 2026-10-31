import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import {
  shiftDateKey, daysBetweenKeys, safeTimeZone, localPartsOf, makeFormatter, makeMinuteFormatter, minuteOf,
} from '../../lib/localParts';
import { computeTimeReport, effectiveLocal, sessionLocalSpan, type ReportSession } from '../../lib/timeReport';
import { loadCurrentGoals, SESSION_GOAL_EXPR, SESSION_GOAL_JOIN } from '../../lib/goalAttribution';
import { Prisma } from '@prisma/client';
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

/**
 * `GET /time-report/goals/:id/daily?tz=IANA`: one goal's focus by local day,
 * all time, for the goal climb in the app's Goals lens.
 *
 * A session counts if its task's CURRENT goal is this one
 * (lib/goalAttribution.ts), so the series always adds up to the goal's
 * `totalFocusSeconds` from /task-goals, and moving a task moves its days.
 * Grouped in SQL with no row cap; days land as in /time-report/history.
 *
 * `startDay` is the goal's creation day in the same zone: where the pace
 * line in /task-goals `timePace` starts.
 */
timeReportRouter.get('/time-report/goals/:id/daily', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }
    const goal = await prisma.taskGoal.findFirst({
      where: { id: String(req.params.id), userId },
      select: { id: true, createdAt: true },
    });
    if (!goal) {
      res.status(404).json({ success: false, error: 'Goal not found' });
      return;
    }

    const timeZone = await postgresTimeZone(safeTimeZone(parsed.data.tz));
    const day = sessionLocalDaySql(timeZone);
    const daily = await prisma.$queryRaw<{ date: string; seconds: number; sessions: number }[]>`
      SELECT ${day} AS date,
             COALESCE(SUM(s.duration_seconds), 0)::int AS seconds,
             COUNT(*)::int AS sessions
      FROM sessions s
      ${SESSION_GOAL_JOIN}
      WHERE s.user_id = ${userId}::uuid AND s.type = 'focus' AND ${SESSION_GOAL_EXPR} = ${goal.id}
      GROUP BY 1
      ORDER BY 1`;

    res.json({
      success: true,
      data: {
        goalId: goal.id,
        timeZone,
        startDay: localPartsOf(goal.createdAt, timeZone).dateKey,
        totalSeconds: daily.reduce((sum, d) => sum + d.seconds, 0),
        daily,
      },
    });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Goal daily error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const SESSIONS_PAGE_DEFAULT = 50;
const SESSIONS_PAGE_MAX = 100;

const sessionsQuerySchema = z
  .object({
    by: z.enum(['goal', 'task']),
    key: z.string().min(1).max(64).optional(),
    none: z.literal('true').optional(),
    from: z.string().regex(DATE, 'from must be YYYY-MM-DD'),
    to: z.string().regex(DATE, 'to must be YYYY-MM-DD'),
    tz: z.string().max(64).optional(),
    cursor: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(SESSIONS_PAGE_MAX).default(SESSIONS_PAGE_DEFAULT),
  })
  .refine((q) => (q.key === undefined) !== (q.none === undefined), {
    message: 'Send exactly one of key or none=true',
  });

/** `<ISO completedAt>|<session id>`, the last row of the previous page. */
function parseSessionCursor(raw: string): { at: number; id: string } | null {
  const [iso, id] = raw.split('|');
  const at = Date.parse(iso);
  return Number.isNaN(at) || !id ? null : { at, id };
}

/**
 * `GET /time-report/sessions?by=goal|task&key=<id>|none=true&from&to&tz&cursor&limit`
 *
 * The sessions behind one row of /time-report, for the drill-down. It uses the
 * same rows and the same rules: sessions fetched by `completedAt` widened a day
 * each side, filed by the resolved local day (effectiveLocal), and matched to a
 * goal by its task's CURRENT goal (lib/goalAttribution.ts). So a goal or task
 * row's seconds in /time-report equal the total here for the same window.
 *
 * `none=true` is the null group: sessions not linked to a goal, or with no
 * task. Newest first; cursor-paginated. An unknown key is an empty list, not
 * a 404, because a row can name a task that has since been archived.
 */
timeReportRouter.get('/time-report/sessions', async (req: Request, res: Response) => {
  if (req.query.by === undefined) {
    await sendTimeline(req, res);
    return;
  }
  try {
    const userId = authenticate(req);

    const parsed = sessionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }
    const { by, key, from, to, tz, limit } = parsed.data;
    const span = daysBetweenKeys(from, to);
    if (span < 0 || span + 1 > MAX_RANGE_DAYS) {
      res.status(400).json({ success: false, error: `Range must run forwards and be ${MAX_RANGE_DAYS} days or fewer` });
      return;
    }
    const cursor = parsed.data.cursor ? parseSessionCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor && !cursor) {
      res.status(400).json({ success: false, error: 'Invalid cursor' });
      return;
    }

    const fetchFrom = new Date(`${shiftDateKey(from, -1)}T00:00:00.000Z`);
    const fetchTo = new Date(`${shiftDateKey(to, 1)}T23:59:59.999Z`);
    const keyFilter = by === 'task'
      ? (key ? Prisma.sql`s.task_id = ${key}` : Prisma.sql`s.task_id IS NULL`)
      : (key ? Prisma.sql`${SESSION_GOAL_EXPR} = ${key}` : Prisma.sql`${SESSION_GOAL_EXPR} IS NULL`);

    const rows = await prisma.$queryRaw<{
      id: string; completed_at: Date; duration_seconds: number; task_id: string | null;
      task_title_snapshot: string | null; primary_tag: string | null; was_recurring: boolean;
      local_date: string | null; local_hour: number | null; local_weekday: number | null; local_date_approx: boolean;
    }[]>`
      SELECT s.id, s.completed_at, s.duration_seconds, s.task_id, s.task_title_snapshot, s.primary_tag,
             s.was_recurring, s.local_date, s.local_hour, s.local_weekday, s.local_date_approx
      FROM sessions s
      ${SESSION_GOAL_JOIN}
      WHERE s.user_id = ${userId}::uuid AND s.type = 'focus'
        AND s.completed_at >= ${fetchFrom} AND s.completed_at <= ${fetchTo}
        AND ${keyFilter}
      ORDER BY s.completed_at DESC, s.id DESC
      LIMIT ${MAX_REPORT_SESSIONS + 1}`;

    const truncated = rows.length > MAX_REPORT_SESSIONS;
    if (truncated) rows.length = MAX_REPORT_SESSIONS;

    const fmt = makeFormatter(safeTimeZone(tz));
    const inRange = rows
      .map((r) => ({
        row: r,
        day: effectiveLocal({
          completedAt: r.completed_at,
          localDate: r.local_date,
          localHour: r.local_hour,
          localWeekday: r.local_weekday,
          localDateApprox: r.local_date_approx,
        }, fmt).dateKey,
      }))
      .filter((r) => r.day >= from && r.day <= to);

    const totals = {
      seconds: inRange.reduce((sum, r) => sum + r.row.duration_seconds, 0),
      sessions: inRange.length,
    };

    const afterCursor = cursor
      ? inRange.filter((r) => {
          const at = r.row.completed_at.getTime();
          return at < cursor.at || (at === cursor.at && r.row.id < cursor.id);
        })
      : inRange;
    const page = afterCursor.slice(0, limit);
    const last = page[page.length - 1];
    const goalByTask = await loadCurrentGoals(
      userId,
      page.map((r) => r.row.task_id).filter((t): t is string => !!t),
    );

    res.json({
      success: true,
      data: {
        totals,
        truncated,
        sessions: page.map(({ row, day }) => ({
          id: row.id,
          completedAt: row.completed_at.toISOString(),
          durationSeconds: row.duration_seconds,
          localDate: day,
          taskId: row.task_id,
          taskTitle: row.task_title_snapshot,
          goalId: row.task_id ? goalByTask.get(row.task_id) ?? null : null,
          primaryTag: row.primary_tag,
          wasRecurring: row.was_recurring,
          approximateDay: row.local_date_approx || row.local_date === null,
        })),
        nextCursor: afterCursor.length > limit && last
          ? `${last.row.completed_at.toISOString()}|${last.row.id}`
          : null,
      },
    });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Time sessions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Longest range for the timeline mode, in days. The calendar's Day and Week
 * views need at most 7; 31 leaves room for a Month view without another change.
 */
const MAX_TIMELINE_DAYS = 31;

/**
 * Strict: the drill-down's `key`, `none`, `cursor` and `limit` mean nothing
 * here, and a client sending them has mixed up the two modes.
 */
const timelineQuerySchema = z
  .object({
    from: z.string().regex(DATE, 'from must be YYYY-MM-DD'),
    to: z.string().regex(DATE, 'to must be YYYY-MM-DD'),
    tz: z.string().max(64).optional(),
  })
  .strict();

/**
 * `GET /time-report/sessions?from&to&tz` (no `by`): every focus session in the
 * range, oldest first and unpaginated, each placed on its local day's timeline
 * for the calendar's plan-vs-actual overlay.
 *
 * Same rules as the drill-down above: fetched by `completedAt` widened a day
 * each side, filed by the resolved local day (effectiveLocal), and given its
 * task's CURRENT goal. `clientSessionId` lets the phone drop a session it
 * still holds in its outbox once the server has it.
 */
async function sendTimeline(req: Request, res: Response): Promise<void> {
  try {
    const userId = authenticate(req);

    const parsed = timelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }
    const { from, to, tz } = parsed.data;
    const span = daysBetweenKeys(from, to);
    if (span < 0 || span + 1 > MAX_TIMELINE_DAYS) {
      res.status(400).json({ success: false, error: `Range must run forwards and be ${MAX_TIMELINE_DAYS} days or fewer` });
      return;
    }

    const rows = await prisma.session.findMany({
      where: {
        userId,
        type: 'focus',
        completedAt: {
          gte: new Date(`${shiftDateKey(from, -1)}T00:00:00.000Z`),
          lte: new Date(`${shiftDateKey(to, 1)}T23:59:59.999Z`),
        },
      },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      take: MAX_REPORT_SESSIONS + 1,
      select: {
        id: true,
        clientSessionId: true,
        completedAt: true,
        durationSeconds: true,
        taskId: true,
        taskTitleSnapshot: true,
        primaryTag: true,
        wasRecurring: true,
        localDate: true,
        localHour: true,
        localWeekday: true,
        localDateApprox: true,
      },
    });
    const truncated = rows.length > MAX_REPORT_SESSIONS;
    if (truncated) rows.length = MAX_REPORT_SESSIONS;

    const zone = safeTimeZone(tz);
    const fmt = makeFormatter(zone);
    const minuteFmt = makeMinuteFormatter(zone);
    const inRange = rows
      .map((row) => ({ row, local: effectiveLocal(row, fmt) }))
      .filter(({ local }) => local.dateKey >= from && local.dateKey <= to);
    const goalByTask = await loadCurrentGoals(
      userId,
      inRange.map(({ row }) => row.taskId).filter((t): t is string => !!t),
    );

    res.json({
      success: true,
      data: {
        truncated,
        sessions: inRange.map(({ row, local }) => ({
          id: row.id,
          clientSessionId: row.clientSessionId,
          completedAt: row.completedAt.toISOString(),
          durationSeconds: row.durationSeconds,
          localDate: local.dateKey,
          taskId: row.taskId,
          taskTitle: row.taskTitleSnapshot,
          goalId: row.taskId ? goalByTask.get(row.taskId) ?? null : null,
          primaryTag: row.primaryTag,
          wasRecurring: row.wasRecurring,
          approximateDay: row.localDateApprox || row.localDate === null,
          ...sessionLocalSpan(local.hour, minuteOf(minuteFmt, row.completedAt), row.durationSeconds),
        })),
      },
    });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Time timeline error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
