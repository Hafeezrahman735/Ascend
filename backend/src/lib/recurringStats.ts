import type { Task } from '@prisma/client';
import { isScheduledOn } from './recurrence';
import { utcDateStr } from './localDate';
import { shiftDateKey } from './localParts';
import { prisma } from './prisma';
import type { Effects } from './transaction';

/**
 * What a recurring task's rule and completion log add up to
 * (docs/designs/recurring-tasks-rule-and-log.md).
 *
 * The task row holds the rule: `recurringDays` (empty = every day) and
 * `dueDate`, the inclusive "repeat until". RecurringCompletion holds one row
 * per day ticked off. Streaks, totals and a day's done-ness are calculated
 * from those two, never stored, so they cannot drift.
 *
 * Every day is judged by the task's CURRENT weekdays, and a day with a log row
 * always counts: narrowing a schedule never loses a completed day.
 */

/** The task's last day as 'YYYY-MM-DD', or null when it repeats forever. */
export function repeatsUntil(task: Pick<Task, 'dueDate'>): string | null {
  return task.dueDate ? utcDateStr(task.dueDate) : null;
}

export type Rule = Pick<Task, 'recurringDays' | 'dueDate' | 'createdAt'>;

export interface RecurringStats {
  /** Consecutive due days done, ending today (or yesterday while today is still open). */
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  /**
   * Whether the most recent due day on or before today was done — what a
   * goal counts. Today, when it is due; otherwise the last due day before it.
   */
  latestDueDayDone: boolean;
}

/**
 * Streaks and totals from the rule and the set of done days, in one pass from
 * the task's first day to `today`.
 *
 * A day is due if the schedule says so or it was done. A due day not done
 * breaks the streak — except today, which is still open. The walk starts at
 * the task's UTC creation day, or an earlier done day: a user west of UTC can
 * tick off a local day that is before the creation instant's UTC day.
 */
export function recurringStats(task: Rule, done: ReadonlySet<string>, today: string): RecurringStats {
  let first = utcDateStr(task.createdAt);
  for (const day of done) if (day < first) first = day;

  const lastDay = repeatsUntil(task);
  let run = 0;
  let longest = 0;
  let latestDueDayDone = false;

  for (let day = first; day <= today; day = shiftDateKey(day, 1)) {
    const isDone = done.has(day);
    if (!isDone && !isScheduledOn(task.recurringDays, day, lastDay)) continue;

    latestDueDayDone = isDone;
    if (isDone) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (day !== today) {
      run = 0;
    }
  }

  return { currentStreak: run, longestStreak: longest, totalCompletions: done.size, latestDueDayDone };
}

export interface RecurringState extends RecurringStats {
  /** The day the state was loaded for. */
  today: string;
  /** Every done day, for callers that judge a specific date. */
  done: ReadonlySet<string>;
  /** When `today` was ticked off, or null. */
  completedTodayAt: Date | null;
  totalFocusSeconds: number;
  sessionsToday: number;
  focusSecondsToday: number;
}

/**
 * State for a batch of one user's recurring tasks, in three queries however
 * many there are: the log, lifetime focus, and today's focus.
 */
export async function loadRecurringState(
  userId: string,
  tasks: Array<Rule & Pick<Task, 'id'>>,
  today: string,
  db: Effects['db'] = prisma,
): Promise<Map<string, RecurringState>> {
  const state = new Map<string, RecurringState>();
  if (tasks.length === 0) return state;
  const ids = tasks.map((t) => t.id);

  const [log, lifetime, todays] = await Promise.all([
    db.recurringCompletion.findMany({
      where: { userId, taskId: { in: ids } },
      select: { taskId: true, date: true, completedAt: true },
    }),
    db.session.groupBy({
      by: ['taskId'],
      where: { userId, taskId: { in: ids }, type: 'focus' },
      _sum: { durationSeconds: true },
    }),
    db.session.groupBy({
      by: ['taskId'],
      where: { userId, taskId: { in: ids }, type: 'focus', localDate: today },
      _count: { _all: true },
      _sum: { durationSeconds: true },
    }),
  ]);

  const doneByTask = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const completedTodayAt = new Map<string, Date>();
  for (const row of log) {
    doneByTask.get(row.taskId)?.add(row.date);
    if (row.date === today) completedTodayAt.set(row.taskId, row.completedAt);
  }
  const lifetimeById = new Map(lifetime.map((g) => [g.taskId, g._sum.durationSeconds ?? 0]));
  const todayById = new Map(todays.map((g) => [g.taskId, g]));

  for (const task of tasks) {
    const done = doneByTask.get(task.id)!;
    const todayGroup = todayById.get(task.id);
    state.set(task.id, {
      ...recurringStats(task, done, today),
      today,
      done,
      completedTodayAt: completedTodayAt.get(task.id) ?? null,
      totalFocusSeconds: lifetimeById.get(task.id) ?? 0,
      sessionsToday: todayGroup?._count._all ?? 0,
      focusSecondsToday: todayGroup?._sum.durationSeconds ?? 0,
    });
  }
  return state;
}

/**
 * A recurring task as one day's row in a task list or on the calendar.
 *
 * The id is the recurring task's own, so every action on the row — tick off,
 * edit, delete, start the timer — targets the task itself. `dueDate` is the
 * row's day, as for any dated task, and the task's real end moves to
 * `repeatsUntil`. The counters are that day's, so a progress bar means
 * "today", while the streak fields describe the whole habit.
 */
export function occurrenceRow<T extends Task>(task: T, state: RecurringState, date: string) {
  return {
    ...task,
    isOccurrence: true as const,
    occurrenceDate: date,
    dueDate: new Date(`${date}T00:00:00.000Z`),
    repeatsUntil: repeatsUntil(task),
    isCompleted: state.done.has(date),
    // Only today's completion time is loaded; earlier days report done, not when.
    completedAt: date === state.today ? state.completedTodayAt : null,
    sessionsOnTask: state.sessionsToday,
    totalTimeOnTask: state.focusSecondsToday,
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    totalCompletions: state.totalCompletions,
    totalFocusSeconds: state.totalFocusSeconds,
  };
}

/** The habit-level figures, for a recurring task shown as itself. */
export function withRecurringStats<T extends Task>(task: T, state: RecurringState, today: string) {
  return {
    ...task,
    repeatsUntil: repeatsUntil(task),
    scheduledToday: isScheduledOn(task.recurringDays, today, repeatsUntil(task)),
    completedToday: state.done.has(today),
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    totalCompletions: state.totalCompletions,
    totalFocusSeconds: state.totalFocusSeconds,
  };
}
