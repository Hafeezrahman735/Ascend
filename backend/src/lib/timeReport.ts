import { daysBetweenKeys, hourLabel, makeFormatter, partsOf, type LocalParts } from './localParts';

/**
 * "Where did my time go, and was that where I wanted it to go?"
 *
 * Those two questions are the whole brief, and they decide the shape below:
 * goals lead, tags come last. A tag says what a thing was about; a goal says
 * whether it mattered. A goal is already a statement of intent — it carries a
 * deadline and the tasks the user chose to attach to it — so `intent.goalLinkedShare`
 * answers question two without asking the user for anything new.
 *
 * ─── Which local day a session belongs to ───────────────────────────────────
 *
 * Two kinds of session reach this function and they cannot be trusted equally:
 *
 *   EXACT      — stamped by the client, which knew its own timezone. This is
 *                what was true where the user was standing. It always wins.
 *   APPROXIMATE — backfilled. The user's timezone at the time was never
 *                recorded, so the day and hour were derived from UTC.
 *
 * The approximate ones are not slightly off, they are off by a whole DAY for
 * any evening session west of Greenwich. A 19:53 session in UTC-5 is 00:53 UTC
 * the next day, so it filed under tomorrow — dropping out of "today" entirely
 * and, at a month boundary, out of the month as well. That is exactly the bug
 * this resolution exists to fix: an approximate stamp is discarded and the day
 * is recomputed from `completedAt` in the caller's CURRENT timezone.
 *
 * Recomputing is right for anyone who has not moved, which is nearly everyone,
 * and it is strictly better than a UTC guess for everyone else. It also means
 * history became correct the moment this shipped, with no second backfill —
 * and no backfill could have been correct anyway, because the information it
 * would have needed was never recorded.
 *
 * ─── Why this aggregates in JS rather than in Postgres ──────────────────────
 *
 * Every field here could be a `groupBy`, but it would be six or seven round
 * trips that still could not do the tag-array involvement or the
 * previous-period comparison in one pass — and none of them could do the
 * resolution above, which is per-row and timezone-dependent. A personal
 * productivity app has bounded history, so one indexed read and a single pass
 * in memory is simpler, faster, and testable without a database.
 */

/** A goal with a deadline this close is due, for the purpose of "starved". */
const STARVED_DEADLINE_DAYS = 14;

/** Below this share of goal-linked time, a due goal counts as starved. */
const STARVED_SHARE = 0.1;

/** Priorities that count toward `intent.urgentShare`. */
const URGENT_PRIORITIES = new Set(['high', 'urgent']);

/** Longest list of individual tasks worth returning. */
const TOP_TASKS = 10;

export interface ReportSession {
  /** The instant. Authoritative — everything else about time is derived. */
  completedAt: Date;
  durationSeconds: number;
  taskId: string | null;
  taskGoalId: string | null;
  goalTitleSnapshot: string | null;
  taskTitleSnapshot: string | null;
  primaryTag: string | null;
  tags: string[];
  priority: string | null;
  wasRecurring: boolean;
  /** Null on a row written before attribution existed. */
  localDate: string | null;
  localHour: number | null;
  localWeekday: number | null;
  /** True when the day/hour were guessed from UTC rather than a real zone. */
  localDateApprox: boolean;
}

/** Live goal facts the frozen session rows cannot know. */
export interface ReportGoal {
  id: string;
  title: string;
  /** 'YYYY-MM-DD' or null. */
  deadline: string | null;
  isCompleted: boolean;
}

export type GoalStatus = 'fed' | 'starved' | 'idle';

export interface GoalRow {
  goalId: string;
  title: string;
  seconds: number;
  sessions: number;
  share: number;
  previousSeconds: number;
  deadline: string | null;
  daysLeft: number | null;
  lastWorkedDate: string | null;
  status: GoalStatus;
}

export interface TimeReport {
  range: { from: string; to: string; days: number };
  totals: {
    seconds: number;
    sessions: number;
    activeDays: number;
    avgSessionSeconds: number;
  };
  previous: { seconds: number; sessions: number };
  intent: {
    goalLinkedSeconds: number;
    unlinkedSeconds: number;
    /** null rather than 0 when nothing was logged — no share exists to report. */
    goalLinkedShare: number | null;
    urgentShare: number | null;
  };
  goals: GoalRow[];
  tasks: {
    taskId: string | null;
    title: string;
    seconds: number;
    sessions: number;
    wasRecurring: boolean;
    goalTitle: string | null;
  }[];
  patterns: {
    byWeekday: number[];
    byHour: number[];
    peakHour: { hour: number; label: string } | null;
    bestWeekday: number | null;
  };
  tags: { tag: string; seconds: number; sessions: number; share: number; previousSeconds: number }[];
  /** Time on sessions with no task attached. Free-form timer use, not a bug. */
  unattributedSeconds: number;
  /**
   * Share of returned time whose local day had to be recomputed because its
   * stored stamp was a UTC guess. Not an error — the recomputed value is the
   * better one — but it is approximate for anyone who has changed timezone.
   */
  approxShare: number;
}

interface Bucket {
  seconds: number;
  sessions: number;
}

function addTo(map: Map<string, Bucket>, key: string, seconds: number): void {
  const b = map.get(key);
  if (b) {
    b.seconds += seconds;
    b.sessions += 1;
  } else {
    map.set(key, { seconds, sessions: 1 });
  }
}

function sumSeconds(map: Map<string, Bucket>): number {
  let total = 0;
  for (const b of map.values()) total += b.seconds;
  return total;
}

/**
 * The local day, hour and weekday to file a session under.
 *
 * See the header: an exact stamp is kept, an approximate one is thrown away
 * and recomputed from the instant in the caller's zone.
 */
function effectiveLocal(s: ReportSession, fmt: Intl.DateTimeFormat): LocalParts {
  if (!s.localDateApprox && s.localDate !== null && s.localHour !== null && s.localWeekday !== null) {
    return { dateKey: s.localDate, hour: s.localHour, weekday: s.localWeekday };
  }
  return partsOf(fmt, s.completedAt);
}

export function computeTimeReport(input: {
  /**
   * Every session that could fall in EITHER window once resolved. The caller
   * widens its query by a day at each end, because a session's resolved day
   * can differ from its UTC day.
   */
  sessions: ReportSession[];
  from: string;
  to: string;
  /** Same-length window immediately before `from`. */
  previousFrom: string;
  previousTo: string;
  goals: ReportGoal[];
  /** Today, 'YYYY-MM-DD', for deadline maths. */
  today: string;
  /** The caller's IANA zone, used to re-resolve approximate rows. */
  timeZone: string;
}): TimeReport {
  const { sessions, from, to, previousFrom, previousTo, goals, today } = input;
  const fmt = makeFormatter(input.timeZone);

  const bySeconds = (a: { seconds: number }, b: { seconds: number }) => b.seconds - a.seconds;

  let totalSeconds = 0;
  let goalLinkedSeconds = 0;
  let urgentSeconds = 0;
  let unattributedSeconds = 0;
  let approxSeconds = 0;

  const activeDays = new Set<string>();
  const byWeekday = new Array(7).fill(0) as number[];
  const byHour = new Array(24).fill(0) as number[];

  const goalBuckets = new Map<string, Bucket>();
  const goalLastWorked = new Map<string, string>();
  const taskBuckets = new Map<string, Bucket>();
  const taskTitles = new Map<string, { title: string; wasRecurring: boolean; goalTitle: string | null }>();
  const tagBuckets = new Map<string, Bucket>();

  const prevGoalBuckets = new Map<string, Bucket>();
  const prevTagBuckets = new Map<string, Bucket>();
  let previousSeconds = 0;
  let previousCount = 0;
  let currentCount = 0;

  // The goal title frozen on a session, for goals that no longer exist.
  const frozenGoalTitles = new Map<string, string>();

  for (const s of sessions) {
    const { dateKey, hour, weekday } = effectiveLocal(s, fmt);
    const secs = s.durationSeconds;

    // Partition by the RESOLVED day, not by the stored one. Anything outside
    // both windows was pulled in only by the query's widening.
    const inCurrent = dateKey >= from && dateKey <= to;
    const inPrevious = !inCurrent && dateKey >= previousFrom && dateKey <= previousTo;

    if (inPrevious) {
      previousSeconds += secs;
      previousCount += 1;
      if (s.taskGoalId) addTo(prevGoalBuckets, s.taskGoalId, secs);
      if (s.primaryTag) addTo(prevTagBuckets, s.primaryTag, secs);
      continue;
    }
    if (!inCurrent) continue;

    currentCount += 1;
    totalSeconds += secs;
    activeDays.add(dateKey);
    byWeekday[weekday] = (byWeekday[weekday] ?? 0) + secs;
    byHour[hour] = (byHour[hour] ?? 0) + secs;
    if (s.localDateApprox) approxSeconds += secs;

    if (s.taskGoalId) {
      goalLinkedSeconds += secs;
      addTo(goalBuckets, s.taskGoalId, secs);
      const seen = goalLastWorked.get(s.taskGoalId);
      if (!seen || dateKey > seen) goalLastWorked.set(s.taskGoalId, dateKey);
      if (s.goalTitleSnapshot && !frozenGoalTitles.has(s.taskGoalId)) {
        frozenGoalTitles.set(s.taskGoalId, s.goalTitleSnapshot);
      }
    }

    if (s.priority && URGENT_PRIORITIES.has(s.priority)) urgentSeconds += secs;

    if (s.taskId) {
      addTo(taskBuckets, s.taskId, secs);
      if (!taskTitles.has(s.taskId)) {
        taskTitles.set(s.taskId, {
          // Falls back rather than rendering an empty row: a session can predate
          // the snapshot columns and still be worth counting.
          title: s.taskTitleSnapshot ?? 'Untitled task',
          wasRecurring: s.wasRecurring,
          goalTitle: s.goalTitleSnapshot,
        });
      }
    } else {
      unattributedSeconds += secs;
    }

    // primaryTag drives the breakdown that has to sum to 100%. `tags` is kept
    // on the row for filtering, but counting a session once per tag here would
    // make the shares add to more than the time actually spent.
    if (s.primaryTag) addTo(tagBuckets, s.primaryTag, secs);
  }

  // ── Goals ──
  const goalById = new Map(goals.map((g) => [g.id, g]));
  // Every goal the user has, plus any goal that only appears in history
  // (deleted since, but its time was still spent).
  const goalIds = new Set<string>([...goals.map((g) => g.id), ...goalBuckets.keys()]);

  const goalRows: GoalRow[] = [];
  for (const goalId of goalIds) {
    const bucket = goalBuckets.get(goalId) ?? { seconds: 0, sessions: 0 };
    const meta = goalById.get(goalId);
    const deadline = meta?.deadline ?? null;
    const daysLeft = deadline ? daysBetweenKeys(today, deadline) : null;

    // A completed goal is not starved, however little time it got — it is done.
    const isDue =
      !meta?.isCompleted && daysLeft !== null && daysLeft <= STARVED_DEADLINE_DAYS;
    const share = goalLinkedSeconds > 0 ? bucket.seconds / goalLinkedSeconds : 0;

    let status: GoalStatus;
    if (bucket.seconds === 0) status = 'idle';
    else if (isDue && share < STARVED_SHARE) status = 'starved';
    else status = 'fed';

    goalRows.push({
      goalId,
      // Prefer the live title; fall back to whatever the sessions froze, which
      // is all that survives once a goal is deleted.
      title: meta?.title ?? frozenGoalTitles.get(goalId) ?? 'Deleted goal',
      seconds: bucket.seconds,
      sessions: bucket.sessions,
      share,
      previousSeconds: prevGoalBuckets.get(goalId)?.seconds ?? 0,
      deadline,
      daysLeft,
      lastWorkedDate: goalLastWorked.get(goalId) ?? null,
      status,
    });
  }

  // Starved first — a goal running out of time is the one thing on this screen
  // worth acting on. Then by time spent; idle goals sink to the bottom.
  const statusRank: Record<GoalStatus, number> = { starved: 0, fed: 1, idle: 2 };
  goalRows.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.seconds - a.seconds);

  // ── Tasks ──
  const taskRows = [...taskBuckets.entries()]
    .map(([taskId, b]) => {
      const meta = taskTitles.get(taskId);
      return {
        taskId,
        title: meta?.title ?? 'Untitled task',
        seconds: b.seconds,
        sessions: b.sessions,
        wasRecurring: meta?.wasRecurring ?? false,
        goalTitle: meta?.goalTitle ?? null,
      };
    })
    .sort(bySeconds)
    .slice(0, TOP_TASKS);

  // ── Tags ──
  const tagTotal = sumSeconds(tagBuckets);
  const tagRows = [...tagBuckets.entries()]
    .map(([tag, b]) => ({
      tag,
      seconds: b.seconds,
      sessions: b.sessions,
      share: tagTotal > 0 ? b.seconds / tagTotal : 0,
      previousSeconds: prevTagBuckets.get(tag)?.seconds ?? 0,
    }))
    .sort(bySeconds);

  // ── Patterns ──
  let peakHour: { hour: number; label: string } | null = null;
  let maxHourSeconds = 0;
  byHour.forEach((seconds, hour) => {
    if (seconds > maxHourSeconds) {
      maxHourSeconds = seconds;
      peakHour = { hour, label: hourLabel(hour) };
    }
  });

  let bestWeekday: number | null = null;
  let maxWeekdaySeconds = 0;
  byWeekday.forEach((seconds, weekday) => {
    if (seconds > maxWeekdaySeconds) {
      maxWeekdaySeconds = seconds;
      bestWeekday = weekday;
    }
  });

  return {
    range: { from, to, days: daysBetweenKeys(from, to) + 1 },
    totals: {
      seconds: totalSeconds,
      sessions: currentCount,
      activeDays: activeDays.size,
      avgSessionSeconds: currentCount > 0 ? Math.round(totalSeconds / currentCount) : 0,
    },
    previous: { seconds: previousSeconds, sessions: previousCount },
    intent: {
      goalLinkedSeconds,
      unlinkedSeconds: totalSeconds - goalLinkedSeconds,
      goalLinkedShare: totalSeconds > 0 ? goalLinkedSeconds / totalSeconds : null,
      urgentShare: totalSeconds > 0 ? urgentSeconds / totalSeconds : null,
    },
    goals: goalRows,
    tasks: taskRows,
    patterns: { byWeekday, byHour, peakHour, bestWeekday },
    tags: tagRows,
    unattributedSeconds,
    approxShare: totalSeconds > 0 ? approxSeconds / totalSeconds : 0,
  };
}
