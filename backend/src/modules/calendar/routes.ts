import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authenticate } from '../../middleware/auth';
import { handleAuthError, handleZodError } from '../../lib/errors';
import { fetchGoogleEvents, isGoogleConfigured, buildAuthUrl, getOAuthClient } from '../../lib/googleCalendar';

export const calendarRouter = Router();

/**
 * OAuth callback. Mounted on its own router because Google redirects a BROWSER
 * here with no Authorization header — it must sit outside authenticateMiddleware.
 * The user is identified by the `state` parameter we set when building the URL.
 */
export const calendarPublicRouter = Router();

calendarPublicRouter.get('/calendar/google/callback', async (req: Request, res: Response) => {
  const deepLink = (status: string) => `${config.APP_DEEP_LINK_SCHEME}://calendar/google-${status}`;
  try {
    const { code, state: userId } = req.query as { code?: string; state?: string };
    if (!code || !userId) {
      res.redirect(deepLink('failed'));
      return;
    }
    if (!isGoogleConfigured()) {
      res.redirect(deepLink('failed'));
      return;
    }

    // `state` comes back from Google unverified, so confirm it names a real user
    // before writing a connection row against it.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      res.redirect(deepLink('failed'));
      return;
    }

    const { tokens } = await getOAuthClient().getToken(code);
    if (!tokens.access_token) {
      res.redirect(deepLink('failed'));
      return;
    }

    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000);

    await prisma.externalCalendarConnection.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      create: {
        userId,
        provider: 'google',
        accessToken: tokens.access_token,
        // No refresh token means we could never renew — prompt:'consent' is set
        // precisely so Google always returns one.
        refreshToken: tokens.refresh_token ?? '',
        expiresAt,
        calendarId: 'primary',
      },
      update: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiresAt,
      },
    });

    res.redirect(deepLink('connected'));
  } catch (err) {
    console.error('[GET /calendar/google/callback]', err);
    res.redirect(deepLink('failed'));
  }
});

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = z.string().regex(YYYY_MM_DD, 'must be a YYYY-MM-DD date');

const rangeSchema = z.object({
  start: dateOnly,
  end: dateOnly,
});

// Cap the window a single request can ask for. A calendar client scrubbing
// months should page, not pull a decade in one query.
const MAX_RANGE_DAYS = 400;

/**
 * Half-open [start, end) instant bounds covering the given inclusive date range.
 *
 * Task.dueDate is a DateTime stored at UTC midnight of the intended calendar day
 * (the convention in lib/localDate.ts), so an inclusive `end` day needs the
 * bound pushed to the following midnight — `lte: end` would drop everything due
 * on the last day.
 */
function rangeBounds(start: string, end: string): { gte: Date; lt: Date } {
  const gte = new Date(`${start}T00:00:00.000Z`);
  const lt = new Date(`${end}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1);
  return { gte, lt };
}

/** UTC calendar day of a Date, as 'YYYY-MM-DD'. */
function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseRange(req: Request): { start: string; end: string } {
  const { start, end } = rangeSchema.parse({
    start: req.query.start,
    end: req.query.end,
  });
  if (start > end) {
    throw new z.ZodError([
      { code: 'custom', path: ['start'], message: 'start must not be after end' },
    ]);
  }
  const spanDays =
    (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) /
      86400000 +
    1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new z.ZodError([
      { code: 'custom', path: ['end'], message: `range must be ${MAX_RANGE_DAYS} days or fewer` },
    ]);
  }
  return { start, end };
}

// ─── GET /calendar ───────────────────────────────────────────────────────────
// Everything schedulable in the range, tagged by `type` so the client renders
// each kind distinctly instead of inferring from shape.
calendarRouter.get('/calendar', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { start, end } = parseRange(req);
    const bounds = rangeBounds(start, end);

    const [tasks, habitInstances, goals, notes, connection] = await Promise.all([
      // Standalone tasks: not recurring templates, not spawned instances.
      prisma.task.findMany({
        where: {
          userId,
          isArchived: false,
          isRecurring: false,
          parentTaskId: null,
          dueDate: bounds,
        },
      }),
      // Habit instances spawned from a recurring template.
      prisma.task.findMany({
        where: {
          userId,
          isArchived: false,
          parentTaskId: { not: null },
          dueDate: bounds,
        },
      }),
      // TaskGoal deadlines. (The old session-target Goal model was removed; goals
      // are TaskGoal now, and `deadline` is a plain @db.Date calendar day.)
      prisma.taskGoal.findMany({
        where: {
          userId,
          isArchived: false,
          deadline: bounds,
        },
      }),
      prisma.note.findMany({
        where: { userId, isArchived: false, date: { gte: start, lte: end } },
      }),
      prisma.externalCalendarConnection.findUnique({
        where: { userId_provider: { userId, provider: 'google' } },
      }),
    ]);

    const items: { type: string; date: string; data: unknown }[] = [
      ...tasks.map((t) => ({ type: 'task', date: toDateKey(t.dueDate!), data: t })),
      ...habitInstances.map((t) => ({ type: 'habit_instance', date: toDateKey(t.dueDate!), data: t })),
      ...goals.map((g) => ({ type: 'goal_deadline', date: toDateKey(g.deadline!), data: g })),
      ...notes.map((n) => ({ type: 'note', date: n.date as string, data: n })),
    ];

    // Google events merge into the same array so the client treats external and
    // local items uniformly. A sync failure degrades to local-only rather than
    // failing the whole calendar.
    let googleSyncError: string | null = null;
    if (connection?.syncEnabled && isGoogleConfigured()) {
      try {
        const events = await fetchGoogleEvents(connection, start, end);
        for (const e of events) {
          items.push({ type: 'external_google', date: e.date, data: e });
        }
      } catch (err) {
        console.error('[GET /calendar] Google sync failed:', err);
        googleSyncError = 'Could not load Google Calendar events';
      }
    }

    res.json({
      success: true,
      data: {
        items,
        googleConnected: !!connection?.syncEnabled,
        googleSyncError,
      },
    });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[GET /calendar]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch calendar data' });
  }
});

// ─── Notes / To-dos ──────────────────────────────────────────────────────────

const createNoteSchema = z.object({
  content: z.string().min(1).max(2000),
  date: dateOnly.nullable().optional(),
  isTodo: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  date: dateOnly.nullable().optional(),
  isCompleted: z.boolean().optional(),
  isTodo: z.boolean().optional(),
});

calendarRouter.get('/notes', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    // Optional range filter; without it, returns unscheduled notes plus everything.
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;
    const ranged = start && end && YYYY_MM_DD.test(start) && YYYY_MM_DD.test(end);

    const notes = await prisma.note.findMany({
      where: {
        userId,
        isArchived: false,
        ...(ranged ? { date: { gte: start, lte: end } } : {}),
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ success: true, data: notes });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[GET /notes]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notes' });
  }
});

calendarRouter.post('/notes', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { content, date, isTodo } = createNoteSchema.parse(req.body);

    const note = await prisma.note.create({
      data: { userId, content, date: date ?? null, isTodo: isTodo ?? false },
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[POST /notes]', err);
    res.status(500).json({ success: false, error: 'Failed to create note' });
  }
});

calendarRouter.patch('/notes/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    const data = updateNoteSchema.parse(req.body);

    const existing = await prisma.note.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(data.content !== undefined && { content: data.content }),
        ...(data.date !== undefined && { date: data.date }),
        ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
        ...(data.isTodo !== undefined && { isTodo: data.isTodo }),
      },
    });

    res.json({ success: true, data: note });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[PATCH /notes/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to update note' });
  }
});

calendarRouter.delete('/notes/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    // Scoped delete — no separate read, so another user's note can never be hit.
    const result = await prisma.note.updateMany({
      where: { id, userId, isArchived: false },
      data: { isArchived: true },
    });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }

    res.json({ success: true, data: null });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[DELETE /notes/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to delete note' });
  }
});

// ─── GET /activity ───────────────────────────────────────────────────────────
// Personal accomplishment log: sessions, tasks, goals, achievements, streaks and
// level-ups in one chronological list.
//
// Deliberately SELF-ONLY and separate from GET /social/feed, which merges the
// caller's events with the people they follow for a reactable activity feed.
// Same table, two different questions: "what have I done" vs "what is everyone
// doing". Surfaced as a Recent Activity section rather than its own tab.
calendarRouter.get('/activity', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { cursor, limit } = z
      .object({
        cursor: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);

    const events = await prisma.feedEvent.findMany({
      where: { userId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;

    res.json({
      success: true,
      data: {
        events: page.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          payload: e.payload,
          createdAt: e.createdAt.toISOString(),
        })),
        cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      },
    });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[GET /activity]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch activity' });
  }
});

// ─── Google Calendar connection ──────────────────────────────────────────────

calendarRouter.get('/calendar/google/status', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const connection = await prisma.externalCalendarConnection.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
      select: { calendarId: true, syncEnabled: true, lastSyncedAt: true },
    });
    res.json({
      success: true,
      data: {
        configured: isGoogleConfigured(),
        connected: !!connection,
        syncEnabled: connection?.syncEnabled ?? false,
        calendarId: connection?.calendarId ?? null,
        lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[GET /calendar/google/status]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Not async: authenticate, isGoogleConfigured and buildAuthUrl are all synchronous.
calendarRouter.get('/calendar/google/auth-url', (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    if (!isGoogleConfigured()) {
      res.status(503).json({ success: false, error: 'Google Calendar is not configured on this server' });
      return;
    }
    res.json({ success: true, data: { url: buildAuthUrl(userId) } });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[GET /calendar/google/auth-url]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

calendarRouter.patch('/calendar/google', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { syncEnabled, calendarId } = z
      .object({ syncEnabled: z.boolean().optional(), calendarId: z.string().max(200).optional() })
      .parse(req.body);

    const result = await prisma.externalCalendarConnection.updateMany({
      where: { userId, provider: 'google' },
      data: {
        ...(syncEnabled !== undefined && { syncEnabled }),
        ...(calendarId !== undefined && { calendarId }),
      },
    });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: 'No Google Calendar connection' });
      return;
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[PATCH /calendar/google]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

calendarRouter.delete('/calendar/google', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    await prisma.externalCalendarConnection.deleteMany({ where: { userId, provider: 'google' } });
    res.json({ success: true, data: null });
  } catch (err) {
    if (handleAuthError(res, err)) return;
    console.error('[DELETE /calendar/google]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── GET /calendar/stats ─────────────────────────────────────────────────────
// Time-allocation analytics for the visible range.
calendarRouter.get('/calendar/stats', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { start, end } = parseRange(req);
    const bounds = rangeBounds(start, end);

    // tzOffset: minutes the client is ahead of UTC, so day-of-week buckets land
    // on the user's calendar day rather than the server's (same approach as
    // /timer/sessions/week).
    const tzOffset = parseInt((req.query.tzOffset as string) ?? '0', 10) || 0;

    const [sessions, user] = await Promise.all([
      prisma.session.findMany({
        where: { userId, type: 'focus', completedAt: bounds },
        select: {
          durationSeconds: true,
          completedAt: true,
          taskLabel: true,
          taskId: true,
        },
      }),
      // Streaks are live user stats, not range-scoped — surfaced here so the
      // calendar's stats panel can show them without a second round trip.
      prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, longestStreak: true },
      }),
    ]);

    // Resolve real tags for any session attached to a task. The Task model has a
    // `tags` array — the session's `taskLabel` is the task TITLE, not a tag, so
    // bucketing by it would produce one bucket per task rather than per category.
    const taskIds = [...new Set(sessions.map((s) => s.taskId).filter((t): t is string => !!t))];
    const tasks = taskIds.length
      ? await prisma.task.findMany({
          where: { id: { in: taskIds }, userId },
          select: { id: true, tags: true },
        })
      : [];
    const tagsByTask = new Map(tasks.map((t) => [t.id, t.tags]));

    // Time allocation by tag. A session on a multi-tag task counts toward each of
    // its tags, so tag totals can exceed totalSeconds — that is intentional for a
    // "where did my time go" breakdown. Untagged work is bucketed separately.
    const byTag: Record<string, number> = {};
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    const byDayOfWeek: Record<string, number> = {
      sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0,
    };
    let totalSeconds = 0;

    // Sessions per calendar day, in the USER's timezone — a session at 11pm local
    // can be the next day in UTC, which would land it on the wrong date and
    // inflate the days-studied count.
    const sessionsPerDay = new Map<string, number>();

    for (const s of sessions) {
      totalSeconds += s.durationSeconds;

      const tags = s.taskId ? tagsByTask.get(s.taskId) ?? [] : [];
      if (tags.length > 0) {
        for (const tag of tags) {
          byTag[tag] = (byTag[tag] ?? 0) + s.durationSeconds;
        }
      } else {
        byTag['Untagged'] = (byTag['Untagged'] ?? 0) + s.durationSeconds;
      }

      const local = new Date(s.completedAt.getTime() + tzOffset * 60_000);
      byDayOfWeek[DAY_KEYS[local.getUTCDay()]] += s.durationSeconds;

      const dayKey = toDateKey(local);
      sessionsPerDay.set(dayKey, (sessionsPerDay.get(dayKey) ?? 0) + 1);
    }

    const daysStudied = sessionsPerDay.size;
    const bestDaySessions = Math.max(0, ...sessionsPerDay.values());

    // Planned vs actual for tasks due in the range that carry an estimate.
    const tasksInRange = await prisma.task.findMany({
      where: {
        userId,
        isArchived: false,
        dueDate: bounds,
        estimatedMinutes: { not: null },
      },
      select: { id: true, title: true, estimatedMinutes: true, totalTimeOnTask: true },
    });

    const plannedVsActual = tasksInRange.map((t) => {
      const estimatedMinutes = t.estimatedMinutes ?? 0;
      const actualMinutes = Math.round((t.totalTimeOnTask ?? 0) / 60);
      // Ratio > 1 means it took longer than planned. Null when there is no
      // estimate to compare against, so the client can skip rather than divide by zero.
      const ratio = estimatedMinutes > 0 ? actualMinutes / estimatedMinutes : null;
      return {
        taskId: t.id,
        title: t.title,
        estimatedMinutes,
        actualMinutes,
        ratio,
        // Flagged when actual is off by more than 50% in either direction and
        // there is real time logged — a 0-minute task isn't an estimation miss yet.
        isOutlier: ratio !== null && actualMinutes > 0 && (ratio > 1.5 || ratio < 0.5),
      };
    });

    res.json({
      success: true,
      data: {
        byTag,
        byDayOfWeek,
        plannedVsActual,
        totalSeconds,
        sessionCount: sessions.length,
        // Range-scoped
        daysStudied,
        bestDaySessions,
        sessionsPerDay: Object.fromEntries(sessionsPerDay),
        // Live user stats — NOT scoped to the requested range.
        currentStreak: user?.currentStreak ?? 0,
        longestStreak: user?.longestStreak ?? 0,
      },
    });
  } catch (err) {
    if (handleZodError(res, err)) return;
    if (handleAuthError(res, err)) return;
    console.error('[GET /calendar/stats]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch calendar stats' });
  }
});

export { parseRange, rangeBounds, toDateKey };
