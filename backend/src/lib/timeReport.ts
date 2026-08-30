import { daysBetweenKeys, hourLabel } from './localParts';

/**
 * "Where did my time go, and was that where I wanted it to go?"
 *
 * Those two questions are the whole brief, and they decide the shape below:
 * goals lead, tags come last. A tag says what a thing was about; a goal says
 * whether it mattered. A goal is already a statement of intent — it carries a
 * deadline and the tasks the user chose to attach to it — so `intent.goalLinkedShare`
 * answers question two without asking the user for anything new.
 *
 * ─── Why this aggregates in JS rather than in Postgres ──────────────────────
 *
 * Every field here could be a `groupBy`, but it would be six or seven round
 * trips that still could not do the tag-array involvement or the
 * previous-period comparison in one pass. A personal productivity app has
 * bounded history — a heavy user at twenty sessions a day produces ~1800 rows
 * a quarter — so one indexed read on (userId, localDate) and a single pass in
 * memory is both simpler and faster. It also makes this a pure function, which
 * is what let `taskAnalytics.ts` catch real bugs before they shipped.
 *
 * The route caps how many rows it will read; see `MAX_REPORT_SESSIONS` there.
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
  durationSeconds: number;
  taskId: string | null;
  taskGoalId: string | null;
  goalTitleSnapshot: string | null;
  taskTitleSnapshot: string | null;
  primaryTag: string | null;
  tags: string[];
  priority: string | null;
  wasRecurring: boolean;
  localDate: string;
  localHour: number;
  localWeekday: number;
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
  /** Share of returned time whose hour had to be inferred. The UI footnotes it. */
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

export function computeTimeReport(input: {
  sessions: ReportSession[];
  /** Same-length window immediately before `from`, for direction of travel. */
  previousSessions: ReportSession[];
  from: string;
  to: string;
  goals: ReportGoal[];
  /** Today, 'YYYY-MM-DD', for deadline maths. */
  today: string;
}): TimeReport {
  const { sessions, previousSessions, from, to, goals, today } = input;

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

  for (const s of sessions) {
    const secs = s.durationSeconds;
    totalSeconds += secs;
    activeDays.add(s.localDate);
    byWeekday[s.localWeekday] = (byWeekday[s.localWeekday] ?? 0) + secs;
    byHour[s.localHour] = (byHour[s.localHour] ?? 0) + secs;
    if (s.localDateApprox) approxSeconds += secs;

    if (s.taskGoalId) {
      goalLinkedSeconds += secs;
      addTo(goalBuckets, s.taskGoalId, secs);
      const seen = goalLastWorked.get(s.taskGoalId);
      if (!seen || s.localDate > seen) goalLastWorked.set(s.taskGoalId, s.localDate);
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

  // ── Previous window, for direction of travel ──
  const prevGoalBuckets = new Map<string, Bucket>();
  const prevTagBuckets = new Map<string, Bucket>();
  let previousSeconds = 0;
  for (const s of previousSessions) {
    previousSeconds += s.durationSeconds;
    if (s.taskGoalId) addTo(prevGoalBuckets, s.taskGoalId, s.durationSeconds);
    if (s.primaryTag) addTo(prevTagBuckets, s.primaryTag, s.durationSeconds);
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
      title: meta?.title
        ?? sessions.find((s) => s.taskGoalId === goalId)?.goalTitleSnapshot
        ?? 'Deleted goal',
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
      sessions: sessions.length,
      activeDays: activeDays.size,
      avgSessionSeconds: sessions.length > 0 ? Math.round(totalSeconds / sessions.length) : 0,
    },
    previous: { seconds: previousSeconds, sessions: previousSessions.length },
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
