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

/**
 * The rule, plus `isCompleted` and `completedAt` where the caller has them: on
 * a recurring task they mean the whole series was completed, and when
 * (docs/designs/tasks-recurring-blocks-sessions.md).
 */
export type Rule = Pick<Task, 'recurringDays' | 'dueDate' | 'createdAt'>
  & { isCompleted?: boolean; completedAt?: Date | null };

/**
 * The stored completedAt of a series is noon UTC of the user's LOCAL day of
 * completion (PATCH /tasks/:id), so its UTC date is that local day with no
 * time zone needed to read it back.
 */
export function seriesCompletedAt(localDay: string): Date {
  return new Date(`${localDay}T12:00:00.000Z`);
}

/**
 * The last day a recurring task is on: its end date, or for a completed series
 * the day it was completed if that comes first. A series completed with no end
 * date would otherwise repeat forever; completing it stops every later day.
 */
export function lastScheduledDay(task: Pick<Task, 'dueDate'> & { isCompleted?: boolean; completedAt?: Date | null }): string | null {
  const end = repeatsUntil(task);
  if (!task.isCompleted || !task.completedAt) return end;
  const completedOn = utcDateStr(task.completedAt);
  return end && end < completedOn ? end : completedOn;
}

/** The earliest UTC offset on earth, for bounding a creation instant's local day. */
const EARLIEST_UTC_OFFSET_MS = 12 * 60 * 60 * 1000;

/**
 * The earliest local day the task could have been created on, in any zone.
 *
 * The row stores an instant, not the creator's zone, so the exact local day
 * is unknown. Bounding by the westernmost zone never turns away a real tick;
 * at worst it allows one day before creation for a user far east of UTC.
 */
export function earliestCreationDay(createdAt: Date): string {
  return utcDateStr(new Date(createdAt.getTime() - EARLIEST_UTC_OFFSET_MS));
}

/**
 * True when no scheduled day remains from `today` to the task's last day: it
 * has ended, or its end comes before its next scheduled day. Only a finished
 * series can be completed as a whole. One that repeats forever never is.
 */
export function isSeriesFinished(task: Pick<Task, 'recurringDays' | 'dueDate'>, today: string): boolean {
  const lastDay = repeatsUntil(task);
  if (!lastDay) return false;
  for (let day = today; day <= lastDay; day = shiftDateKey(day, 1)) {
    if (isScheduledOn(task.recurringDays, day, lastDay)) return false;
  }
  return true;
}

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
  /** Days the CURRENT rule schedules in the counting window (see recurringStats). */
  scheduledDays: number;
  /** Of those, the days ticked off. Never more than scheduledDays. */
  doneOnSchedule: number;
  /** scheduledDays − doneOnSchedule: past scheduled days not ticked (yesterday included). */
  missedDays: number;
}

/**
 * Streaks, totals and missed days from the rule and the set of done days, in
 * one pass from the task's first day to `today`.
 *
 * A day is due if the schedule says so or it was done. A due day not done
 * breaks the streak and counts as missed, except today, which is still open.
 * An unticked yesterday counts as missed until it is marked done (it can
 * still be ticked; the figures follow when it is). The founder chose this
 * over treating yesterday as open (2026-11-10): a miss is shown as a miss.
 *
 * Missed days count only days the CURRENT rule schedules, from the first day
 * to yesterday, and never past the series end. `totalCompletions` stays every
 * log row, so it can exceed doneOnSchedule after a schedule is narrowed.
 *
 * The walk starts at the task's UTC creation day, or an earlier done day: a
 * user west of UTC can tick off a local day before the creation instant's UTC
 * day.
 */
export function recurringStats(task: Rule, done: ReadonlySet<string>, today: string): RecurringStats {
  let first = utcDateStr(task.createdAt);
  for (const day of done) if (day < first) first = day;

  const lastDay = lastScheduledDay(task);
  const yesterday = shiftDateKey(today, -1);
  const windowEnd = lastDay && lastDay < yesterday ? lastDay : yesterday;

  let run = 0;
  let longest = 0;
  let latestDueDayDone = false;
  let scheduledDays = 0;
  let doneOnSchedule = 0;

  for (let day = first; day <= today; day = shiftDateKey(day, 1)) {
    const isDone = done.has(day);
    const scheduled = isScheduledOn(task.recurringDays, day, lastDay);
    if (scheduled && day <= windowEnd) {
      scheduledDays += 1;
      if (isDone) doneOnSchedule += 1;
    }
    if (!isDone && !scheduled) continue;

    latestDueDayDone = isDone;
    if (isDone) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (day !== today) {
      run = 0;
    }
  }

  return {
    currentStreak: run,
    longestStreak: longest,
    totalCompletions: done.size,
    latestDueDayDone,
    scheduledDays,
    doneOnSchedule,
    missedDays: scheduledDays - doneOnSchedule,
  };
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
    scheduledDays: state.scheduledDays,
    doneOnSchedule: state.doneOnSchedule,
    missedDays: state.missedDays,
  };
}

/**
 * The habit-level figures, for a recurring task shown as itself. Here the
 * task's own `isCompleted` means the whole series was completed; a day row
 * (occurrenceRow) uses the same name for that day's tick, and is never built
 * for a completed series.
 */
export function withRecurringStats<T extends Task>(task: T, state: RecurringState, today: string) {
  const lastDay = lastScheduledDay(task);
  const yesterday = shiftDateKey(today, -1);
  return {
    ...task,
    repeatsUntil: repeatsUntil(task),
    scheduledToday: isScheduledOn(task.recurringDays, today, lastDay),
    completedToday: state.done.has(today),
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    totalCompletions: state.totalCompletions,
    totalFocusSeconds: state.totalFocusSeconds,
    scheduledDays: state.scheduledDays,
    doneOnSchedule: state.doneOnSchedule,
    missedDays: state.missedDays,
    seriesFinished: isSeriesFinished(task, today),
    // Yesterday can still be ticked: scheduled, inside the task's life, not done.
    yesterdayOpen: !task.isCompleted
      && !state.done.has(yesterday)
      && isScheduledOn(task.recurringDays, yesterday, lastDay)
      && yesterday >= earliestCreationDay(task.createdAt),
  };
}
