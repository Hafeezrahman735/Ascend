import { dayNameFromLocalDate } from './localDate';

/**
 * The single definition of "when does this recurring task happen".
 *
 * Previously this rule existed three times: inline in spawn-recurring, again in
 * the calendar projection, and a third time in the mobile client. Three copies
 * of one schedule is how a habit shows as due on the calendar and not-due in the
 * task list on the same day.
 *
 * Everything that needs to answer a scheduling question imports from here.
 *
 * A schedule has an optional END. `endDate` is the template's own dueDate, as
 * 'YYYY-MM-DD', and it means "repeat until this day, INCLUSIVE" — the last day
 * the habit fires, not the first day it stops. Before this existed a recurring
 * task ran forever: the spawner checked only the weekday, the calendar bounded
 * projections by createdAt and nothing else, and a due date set on a template
 * was read by nothing at all. Users could set an end date and watch it be
 * ignored.
 *
 * The bound lives HERE, with the schedule rule, for the same reason the rule
 * itself does: three copies of "when does this happen" is how a habit ends in
 * the task list and keeps going on the calendar.
 */

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayName = (typeof DAY_ORDER)[number];

/**
 * An empty `recurringDays` means every day — the spawner's long-standing rule.
 *
 * `endDate` is inclusive: a habit ending on the 10th still fires on the 10th.
 * Null or undefined means it never ends, which is every template created before
 * end dates existed.
 */
export function isScheduledOn(
  recurringDays: string[],
  date: string,
  endDate?: string | null,
): boolean {
  if (endDate && date > endDate) return false;
  if (recurringDays.length === 0) return true;
  return recurringDays.includes(dayNameFromLocalDate(date));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days until this schedule next fires, counting `from` as 0.
 *
 * Returns null when no valid day is selected, which is a real state: a template
 * can be saved with recurring on and no days ticked, and the caller has to say
 * something honest about it rather than showing a wrong date.
 */
export function daysUntilNextOccurrence(
  recurringDays: string[],
  from: string,
  endDate?: string | null,
): number | null {
  // Already over. Null here is what makes "next occurrence" read as "never
  // again" downstream rather than pointing at a day the habit will not fire.
  if (endDate && from > endDate) return null;
  if (recurringDays.length === 0) return 0;
  const valid = recurringDays.filter((d) => (DAY_ORDER as readonly string[]).includes(d));
  if (valid.length === 0) return null;

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(from, offset);
    // A schedule can end mid-week: Mon/Wed/Fri ending on a Tuesday has no next
    // occurrence even though Wednesday matches the weekday.
    if (endDate && candidate > endDate) return null;
    if (valid.includes(dayNameFromLocalDate(candidate))) return offset;
  }
  return null;
}

/**
 * The next date this schedule fires, as 'YYYY-MM-DD'. `from` itself if due.
 * Null once the schedule has ended, which callers render as "no longer repeats".
 */
export function nextOccurrence(
  recurringDays: string[],
  from: string,
  endDate?: string | null,
): string | null {
  const days = daysUntilNextOccurrence(recurringDays, from, endDate);
  return days === null ? null : addDays(from, days);
}
