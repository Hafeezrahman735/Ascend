/**
 * Per-task focus analytics.
 *
 * Extracted from `GET /tasks/:id`, where it was 80 lines of inline arithmetic
 * that nothing could reach without an HTTP round trip. Same reason
 * `goalProgress.ts` exists: the numbers a user reads are worth a unit test.
 *
 * ─── Why every bucket is a string comparison ────────────────────────────────
 *
 * The previous version bucketed by UTC — `getUTCHours()` for the peak hour,
 * `toISOString().split('T')[0]` for day keys — and then labelled the result as
 * if it were local time. A user in UTC-5 who works at 9am was told their peak
 * hour was 2pm, and a 9pm session landed on the NEXT day's bar in the 7-day
 * chart.
 *
 * The fix resolves every timestamp to the caller's IANA zone via Intl, then
 * does all bucketing on 'YYYY-MM-DD' strings. Strings rather than Date maths
 * because local days are not all 24 hours long: subtracting 86_400_000ms
 * across a DST boundary either skips a local date or repeats one. Calendar
 * arithmetic on the date parts has no such failure mode, and ISO date strings
 * sort correctly with `<`/`>=`, so range checks stay trivial.
 */

/** Sunday-first, matching `Intl` weekday output and `Date.getDay()`. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** A session counts as "full" if it ran at least this share of its plan. */
const FULL_SESSION_THRESHOLD = 0.9;

export interface AnalyticsSession {
  durationSeconds: number;
  plannedDurationSeconds: number | null;
  completedAt: Date;
}

export interface TaskAnalytics {
  totalTimeToday: number;
  totalTimeThisWeek: number;
  totalTimeThisMonth: number;
  totalTimeAllTime: number;
  timePerDayLast7: { date: string; seconds: number }[];
  mostProductiveHour: { hour: number; label: string } | null;
  avgSessionLength: number;
  sessionCount: number;

  /**
   * Share of sessions that ran to (near) completion — NOT "tasks done over
   * tasks planned", which is what the UI used to call it.
   */
  fullSessionRate: number;
  /** @deprecated Misnamed alias of `fullSessionRate`, kept so app builds
   *  shipped before this change keep rendering a number instead of `0%`.
   *  Remove once those builds have aged out. */
  completionRate: number;

  /**
   * How close the actual time came to the estimate: 100 when they match,
   * falling to 0 as it deviates by a full estimate in either direction.
   *
   * The old field of this name was `actual / estimate * 100`, so a task that
   * ran three times over reported "300% accuracy" — a number that reads as
   * excellent and means the opposite. That quantity is still available as
   * `estimateUsedPct`, which is what the progress bar wants.
   */
  estimationAccuracy: number | null;
  estimateUsedPct: number | null;
  /** Signed: positive is over the estimate, negative is under. */
  estimateDeltaSeconds: number | null;

  /** Distinct local days with at least one session. */
  daysWorked: number;
  /**
   * `daysWorked` over the task's age in days, capped at 1. Answers "am I
   * chipping away at this or did I cram it", which no total can.
   */
  consistency: number | null;
  /** Newest session, ISO, or null if none. Surfaces a stalled task. */
  lastSessionAt: string | null;
}

interface LocalParts {
  dateKey: string;
  hour: number;
  weekday: number;
}

/**
 * Resolve an instant into its calendar parts in `timeZone`.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which yields "24" for
 * midnight in some ICU versions and would put every midnight session into a
 * bucket that cannot exist.
 */
function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
}

function partsOf(fmt: Intl.DateTimeFormat, d: Date): LocalParts {
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * Shift a 'YYYY-MM-DD' key by whole calendar days.
 *
 * Uses UTC constructors purely as calendar arithmetic on the date parts — no
 * instant is involved, so no DST rule can apply and the result is exact.
 */
function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to`, both 'YYYY-MM-DD'. */
function daysBetweenKeys(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/** "9am" / "12pm" / "11pm" for an hour in 0..23. */
function hourLabel(hour: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}${period}`;
}

/**
 * `Intl` throws on an unknown zone, and the zone arrives from a client query
 * string, so it is untrusted input. Fall back to UTC rather than 500ing a
 * stats screen because somebody sent a typo.
 */
export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function computeTaskAnalytics(input: {
  sessions: AnalyticsSession[];
  estimatedMinutes: number | null;
  createdAt: Date;
  now: Date;
  timeZone: string;
}): TaskAnalytics {
  const { sessions, estimatedMinutes, createdAt, now } = input;
  const fmt = makeFormatter(input.timeZone);

  const today = partsOf(fmt, now);
  const todayKey = today.dateKey;

  // Monday-start week, matching the client's `getMonday`.
  const mondayOffset = today.weekday === 0 ? -6 : 1 - today.weekday;
  const weekStartKey = shiftDateKey(todayKey, mondayOffset);
  const monthPrefix = todayKey.slice(0, 7);

  const last7 = new Map<string, number>();
  for (let i = 6; i >= 0; i--) last7.set(shiftDateKey(todayKey, -i), 0);

  let totalTimeToday = 0;
  let totalTimeThisWeek = 0;
  let totalTimeThisMonth = 0;
  let totalTimeAllTime = 0;
  let fullSessions = 0;
  let lastSessionMs = 0;

  const secondsByHour = new Map<number, number>();
  const workedDays = new Set<string>();

  for (const s of sessions) {
    const { dateKey, hour } = partsOf(fmt, s.completedAt);

    totalTimeAllTime += s.durationSeconds;
    workedDays.add(dateKey);
    lastSessionMs = Math.max(lastSessionMs, s.completedAt.getTime());

    if (dateKey === todayKey) totalTimeToday += s.durationSeconds;
    if (dateKey >= weekStartKey) totalTimeThisWeek += s.durationSeconds;
    if (dateKey.startsWith(monthPrefix)) totalTimeThisMonth += s.durationSeconds;

    const bucket = last7.get(dateKey);
    if (bucket !== undefined) last7.set(dateKey, bucket + s.durationSeconds);

    secondsByHour.set(hour, (secondsByHour.get(hour) ?? 0) + s.durationSeconds);

    // No planned length means nothing to fall short of, so it counts as full.
    const ranFullLength =
      !s.plannedDurationSeconds ||
      s.durationSeconds >= s.plannedDurationSeconds * FULL_SESSION_THRESHOLD;
    if (ranFullLength) fullSessions++;
  }

  // Ranked by seconds focused, not by session count. The client's
  // `getPeakHour` ranks by count and answers a different question with the
  // same words; this is the definition the stats sheet reads.
  let mostProductiveHour: { hour: number; label: string } | null = null;
  let maxHourSeconds = 0;
  for (const [hour, seconds] of secondsByHour) {
    if (seconds > maxHourSeconds) {
      maxHourSeconds = seconds;
      mostProductiveHour = { hour, label: hourLabel(hour) };
    }
  }

  const sessionCount = sessions.length;
  const avgSessionLength =
    sessionCount > 0 ? Math.round(totalTimeAllTime / sessionCount) : 0;
  const fullSessionRate =
    sessionCount > 0 ? Math.round((fullSessions / sessionCount) * 100) : 0;

  let estimationAccuracy: number | null = null;
  let estimateUsedPct: number | null = null;
  let estimateDeltaSeconds: number | null = null;
  if (estimatedMinutes && estimatedMinutes > 0) {
    const estimateSeconds = estimatedMinutes * 60;
    estimateDeltaSeconds = totalTimeAllTime - estimateSeconds;
    estimateUsedPct = Math.round((totalTimeAllTime / estimateSeconds) * 100);
    estimationAccuracy = Math.max(
      0,
      Math.round(100 - (Math.abs(estimateDeltaSeconds) / estimateSeconds) * 100),
    );
  }

  // Inclusive of both ends: a task created today that was worked today is one
  // day out of one, not one out of zero.
  const ageDays = Math.max(
    1,
    daysBetweenKeys(partsOf(fmt, createdAt).dateKey, todayKey) + 1,
  );
  const daysWorked = workedDays.size;

  return {
    totalTimeToday,
    totalTimeThisWeek,
    totalTimeThisMonth,
    totalTimeAllTime,
    timePerDayLast7: [...last7].map(([date, seconds]) => ({ date, seconds })),
    mostProductiveHour,
    avgSessionLength,
    sessionCount,
    fullSessionRate,
    completionRate: fullSessionRate,
    estimationAccuracy,
    estimateUsedPct,
    estimateDeltaSeconds,
    daysWorked,
    consistency: daysWorked > 0 ? Math.min(1, daysWorked / ageDays) : null,
    lastSessionAt: lastSessionMs > 0 ? new Date(lastSessionMs).toISOString() : null,
  };
}
