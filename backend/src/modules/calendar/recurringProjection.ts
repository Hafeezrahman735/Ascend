import { dayNameFromLocalDate, utcDateStr } from '../../lib/localDate';

/**
 * Projects recurring tasks across a date range.
 *
 * A recurring task is a rule plus a log of done days (lib/recurringStats.ts),
 * so every day it falls on is calculated, past and future alike. Each is
 * reported with whether it was done.
 *
 * Uses the same `dayNameFromLocalDate` as every other schedule check, so the
 * calendar and the task list can never disagree about which days a task is on.
 */

export interface RecurringLike {
  id: string;
  recurringDays: string[];
  /**
   * When the task was created. Occurrences are never projected before this:
   * without the bound, creating a habit today makes every earlier day in the
   * month render as an un-completed occurrence, indistinguishable from a day the
   * user genuinely missed.
   */
  createdAt: Date;
  /**
   * The last day this task repeats, INCLUSIVE, or null for "forever". Without
   * it a habit the user had ended still drew occurrences on every future month.
   */
  dueDate: Date | null;
  /** A deleted task shows the days it was done, and is not projected. */
  isArchived: boolean;
}

export interface Occurrence<T extends RecurringLike> {
  /** 'YYYY-MM-DD' */
  date: string;
  task: T;
  isCompleted: boolean;
}

/** Every 'YYYY-MM-DD' from start to end inclusive. */
export function eachDateInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return out;

  // Guard against an inverted or absurd range producing an unbounded loop.
  let guard = 0;
  while (cursor <= last && guard < 3660) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

/**
 * Every day in range each task is on, plus any done day it is no longer on:
 * a day that was ticked off always counts, so editing a schedule never wipes
 * completed work off the calendar.
 */
export function projectRecurring<T extends RecurringLike>(params: {
  tasks: T[];
  /** Done days per task id. */
  done: ReadonlyMap<string, ReadonlySet<string>>;
  start: string;
  end: string;
}): Occurrence<T>[] {
  const { tasks, done, start, end } = params;
  const none: ReadonlySet<string> = new Set();

  // Precomputed once per date and task rather than once per (date, task) pair:
  // a 400-day range across 20 tasks is 8000 pairs, and each call otherwise
  // parses a new Date.
  const dates = eachDateInRange(start, end);
  const dayNames = new Map(dates.map((d) => [d, dayNameFromLocalDate(d)]));
  const bounds = new Map(
    tasks.map((t) => [t.id, {
      from: utcDateStr(t.createdAt),
      until: t.dueDate ? utcDateStr(t.dueDate) : null,
    }] as const),
  );

  const out: Occurrence<T>[] = [];
  for (const date of dates) {
    const dayName = dayNames.get(date)!;
    for (const task of tasks) {
      const isCompleted = (done.get(task.id) ?? none).has(date);
      const { from, until } = bounds.get(task.id)!;
      const scheduled =
        !task.isArchived &&
        date >= from &&
        (!until || date <= until) &&
        (task.recurringDays.length === 0 || task.recurringDays.includes(dayName));
      if (scheduled || isCompleted) out.push({ date, task, isCompleted });
    }
  }
  return out;
}
