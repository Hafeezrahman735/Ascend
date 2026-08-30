import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { handleAuthError } from '../../lib/errors';
import { shiftDateKey, daysBetweenKeys, safeTimeZone, localPartsOf } from '../../lib/localParts';
import { computeTimeReport, type ReportSession } from '../../lib/timeReport';

/**
 * `GET /time-report?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Reads frozen attribution off the session rows and aggregates it. No joins:
 * everything the report needs was stamped when the session was saved (see
 * lib/sessionAttribution.ts), which is what makes this a single indexed read
 * rather than a per-row lookup against a task list that excludes archived rows.
 *
 * Range filtering compares `localDate` strings, so there is no timezone maths
 * at read time and no re-derivation of buckets on every request.
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
  durationSeconds: true,
  taskId: true,
  taskGoalId: true,
  goalTitleSnapshot: true,
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
  durationSeconds: number;
  taskId: string | null;
  taskGoalId: string | null;
  goalTitleSnapshot: string | null;
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
 * Rows are typed nullable because the columns are, but the query filters
 * `localDate` to a range, so anything that comes back has been stamped. The
 * hour/weekday defaults are belt and braces for a row written by an older
 * build rather than a case that should occur.
 */
function toReportSession(row: SessionRow): ReportSession {
  return {
    durationSeconds: row.durationSeconds,
    taskId: row.taskId,
    taskGoalId: row.taskGoalId,
    goalTitleSnapshot: row.goalTitleSnapshot,
    taskTitleSnapshot: row.taskTitleSnapshot,
    primaryTag: row.primaryTag,
    tags: row.tags,
    priority: row.priority,
    wasRecurring: row.wasRecurring,
    localDate: row.localDate ?? '',
    localHour: row.localHour ?? 0,
    localWeekday: row.localWeekday ?? 0,
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

    const [rows, prevRows, goals] = await Promise.all([
      prisma.session.findMany({
        where: { userId, type: 'focus', localDate: { gte: from, lte: to } },
        select: REPORT_SELECT,
        take: MAX_REPORT_SESSIONS,
      }),
      prisma.session.findMany({
        where: { userId, type: 'focus', localDate: { gte: prevFrom, lte: prevTo } },
        select: REPORT_SELECT,
        take: MAX_REPORT_SESSIONS,
      }),
      prisma.taskGoal.findMany({
        where: { userId, isArchived: false },
        select: { id: true, title: true, deadline: true, isCompleted: true },
      }),
    ]);

    // "Today" for deadline maths, in the caller's zone. Falls back to UTC.
    const today = localPartsOf(new Date(), safeTimeZone(tz)).dateKey;

    const report = computeTimeReport({
      sessions: rows.map(toReportSession),
      previousSessions: prevRows.map(toReportSession),
      from,
      to,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
        isCompleted: g.isCompleted,
      })),
      today,
    });

    // An empty report is ambiguous: it can mean "you did not work" or "the
    // backfill has not run in this environment yet". Only pay for the extra
    // count when the answer is empty, and say which it is.
    let unstampedSessions = 0;
    if (report.totals.sessions === 0) {
      unstampedSessions = await prisma.session.count({
        where: { userId, type: 'focus', localDate: null },
      });
    }

    res.json({ success: true, data: { ...report, unstampedSessions } });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('Time report error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
