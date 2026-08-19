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
 */

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayName = (typeof DAY_ORDER)[number];

/** An empty `recurringDays` means every day — the spawner's long-standing rule. */
export function isScheduledOn(recurringDays: string[], date: string): boolean {
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
export function daysUntilNextOccurrence(recurringDays: string[], from: string): number | null {
  if (recurringDays.length === 0) return 0;
  const valid = recurringDays.filter((d) => (DAY_ORDER as readonly string[]).includes(d));
  if (valid.length === 0) return null;

  for (let offset = 0; offset < 7; offset += 1) {
    if (valid.includes(dayNameFromLocalDate(addDays(from, offset)))) return offset;
  }
  return null;
}

/** The next date this schedule fires, as 'YYYY-MM-DD'. `from` itself if due. */
export function nextOccurrence(recurringDays: string[], from: string): string | null {
  const days = daysUntilNextOccurrence(recurringDays, from);
  return days === null ? null : addDays(from, days);
}
